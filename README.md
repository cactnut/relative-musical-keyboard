# relative-musical-keyboard



**相対的キーボード（ブラウザ版 / Chrome前提）**のMVP仕様
 PC／スマホ横画面、**タップ／クリック／PCキーボード**で操作できます。

------

## 1. 目的・動作定義

- **相対入力**：横一列に並ぶキーは「Δ（半音差）」を表す。中央キーはΔ=0（同音再発音）。
- **2モード**
  - **Follow**（既定）：次音 = `clamp(current + Δ')`
  - **Anchor**：次音 = `clamp(root + Δ')`
- **スケール量子化（任意ON）**：`Δ' = quantize_to_scale(base_note, Δ)`
  - `base_note` は Follow時= `current`、Anchor時= `root`
  - スケールOFF時は `Δ' = Δ`（クロマチック）
- **クランプ**：`0 ≤ next_midi ≤ 127` で打ち止め（端ではそれ以上進まない）
- **再トリガ**：同じΔを連続押下しても必ずADSRを再トリガする（レガートは将来オプション）

------

## 2. 対象・前提

- **ブラウザ**：Chrome 最新版（PC / Android Chrome / iOS版Chrome※WebKit）。
- **向き**：横画面（portrait時は回転案内を表示）。
- **音源**：Web Audio API（モノフォニック）。必要ならWeb MIDI出力は別設定でON。

------

## 3. 画面構成（横画面）

1. **ヘッダ**
   - [Audio Start]（必須：初回タップでAudioContext解錠）
   - [Mode] 切替（Follow / Anchor）
   - [Scale]（Chromatic / Major / Minor）※MVPで3種
   - [Root]（C2〜C6 選択）
   - [Reset]（`current = root`）
   - [Undo]（1手戻す。スタック上限=100）
2. **状態表示**
    `Root=C4 / Current=E4 / Δ(last)=+4 / Mode=Follow / Scale=Chromatic`
3. **相対キー列（タップ／クリック用）**
   - **25キー**：`Δ = -12 … 0 … +12`（中央=0は強調）
   - キーには **Δ表記** と **着地音名プレビュー**（例：`+4 (E4)`）を表示
   - **押下中ハイライト**、クランプで動かない場合は軽い点滅でフィードバック
4. **フッタ**（任意）
   - ラテンシ表示（平均オーディオ遅延の簡易推定）
   - キーボード入力ON/OFFトグル（デフォルトON）

------

## 4. 入力仕様

### 4.1 ポインタイベント（タップ／クリック）

- `pointerdown`：Δ確定 → `noteOn(next_midi)`（即時）
- `pointerup|pointercancel`：`noteOff()`（ホールド再生ON時のみ使用。MVPはワンショット0.2sでも可）
- **マルチタッチ**：MVPは**モノフォニック**
  - 最初のpointerIdのみ有効、他は無視（設定で「常に最後の指を採用」へ切替可能）
- スクロール防止：キー領域は `touch-action: none`

### 4.2 PCキーボード（`event.code`で物理位置基準）

> **狙い**：US/JIS配列差を吸収。`event.key`は使わない。

- **基本**
  - `Space` = Δ=0（同音再発音）
  - `ArrowLeft/Right` = Δ=±1
  - `ArrowUp/Down` = Δ=±12
- **フルマッピング（±12をレター配列で直接指定）**
  - **負側（左手〜下段）**
    - `KeyZ:-12, KeyX:-11, KeyC:-10, KeyV:-9, KeyB:-8, KeyN:-7, KeyM:-6`
    - `KeyA:-5, KeyS:-4, KeyD:-3, KeyF:-2`
  - **中央**
    - `KeyG:0`
  - **正側（右手〜上段）**
    - `KeyH:+1, KeyJ:+2, KeyK:+3, KeyL:+4, Semicolon:+5`
    - `KeyY:+6, KeyU:+7, KeyI:+8, KeyO:+9, KeyP:+10, BracketRight:+11, Backslash|IntlYen:+12`
- **その他**
  - `KeyR` = Reset（現在音をRootへ）
  - `KeyQ` = Mode切替、`KeyW` = Scale切替（循環）
- **リピート**
  - `keydown`は**初回のみ**処理（OSのオートリピートは無視）。
  - 連打を許可する場合のみ、`repeat`フラグONで再トリガ。
- `preventDefault()`：`Space/Arrow`はスクロール抑止。ページショートカットと競合しないキーを選定済み。

------

## 5. サウンド仕様（MVP）

- **Synth**：Oscillator（`sawtooth`）+ Gain（ADSR）
  - Attack 5ms / Decay 50ms / Sustain 0.4 / Release 80ms（開始時刻基準）
  - ベロシティ：固定0.6（将来、押下長やジェスチャで可変）
- **レイテンシ**：`new AudioContext({ latencyHint: 'interactive' })`
  - クリックノイズ回避のため**必ず**短いA/Rを入れる
- **スケジューリング**：即時発音（MVP）。将来ルーパー時はlookahead ~25ms
- **音量安全**：マスター-6dB、クリップ検出でソフトリミット（任意）

------

## 6. ロジック仕様（擬似）

```
state: {
  rootMidi: 60,         // C4
  currentMidi: 60,
  mode: 'follow'|'anchor',
  scale: 'chromatic'|'major'|'minor',
  history: []           // push {deltaApplied, prevMidi, nextMidi, ts}
}

onDelta(Δ):
  base = (state.mode === 'follow') ? state.currentMidi : state.rootMidi
  Δ' = (state.scale === 'chromatic') ? Δ : quantizeDelta(base, Δ, state.scale)
  next = clamp(base + Δ', 0, 127)
  synth.noteOn(next)            // 再トリガ
  pushHistory(Δ, state.currentMidi, next)
  state.currentMidi = next
  updateStatusUI()

Reset():
  state.currentMidi = state.rootMidi
  updateStatusUI()

Undo():
  if (history.length) pop and restore prevMidi

quantizeDelta(base, Δ, scale):
  // 例：Majorの度数移動を半音化（W-W-H-W-W-W-H）
  // baseをスケール上へスナップ → その度数からΔ度移動 → 半音換算
```

------

## 7. レイアウト・UI仕様

- **相対キー列**：幅いっぱい、各キーは同幅（中央のみ強調）
- **フォント**：システムUI（遅延回避のためWebFont不使用）
- **視認性**：押下中は明滅せず**反転**、クランプ時は**振動アニメ（8ms×2）**
- **アクセシビリティ**：各キーに `aria-label="Delta +4 semitones"`、状態領域は`role=status`でライブ更新

------

## 8. エッジケース

- **クランプ端**でさらに外側Δが押された場合：音は変えないが**無効入力フィードバック**を返す
- **スケールON時**、現`current`がスケール外：まず最近傍スケール音へ**内部スナップ**してからΔ反映
- **iOS**：初回ユーザー操作まではAudioContext停止。`Audio Start`後のみ発音
- **ブラウザバック**等のショートカット競合を避けるため、ページ内は**全キー操作でフォーカス維持**

------

## 9. 設定（ローカル保存：`localStorage`）

- `mode / scale / rootMidi`
- キーボード有効フラグ
- 直近キー幅（ズーム）※モバイル
- 音量・波形（sine/saw/square）※任意

------

## 10. テスト観点（MVP）

- **機能**：各Δで期待ピッチに着地／FollowとAnchorの差分／Reset／Undo
- **クランプ**：MIDI 0/127近傍での入力
- **キーマッピング**：`event.code`でUS/JISの差異なく動くこと（`IntlYen`/`Backslash`）
- **モバイル**：横画面固定／マルチタッチ中の無視ロジック／スクロールしない
- **音**：連打でクリックが出ない／アタック遅延がない

------

## 11. 既定値（MVP）

- `root=C4 (60)`, `current=C4`, `mode=Follow`, `scale=Chromatic`
- 25キー表示、モノフォニック、ADSRは上記値、音量0.6

------

## 12. 将来拡張（任意）

- **相対ステップ列の録音/再生（Root可変）**
- **度数表示（スケール時に －V など）とガイド音（トニック/ドミナント）**
- **ジェスチャ版**：横スワイプ距離→Δ、縦→ベロシティ
- **ポリフォニー／和音モード**（基準をどう定義するかは別設計）
- **Web MIDI入出力**（外部音源／鍵盤でRootセット）

------

### 補足：キーボード対応まとめ（抜粋）

- Δ=0：`Space` / `KeyG`
- ±1：`ArrowLeft/Right` / `KeyF`(−1), `KeyH`(+1)
- ±12：`ArrowDown/Up` / `KeyZ`(−12), `Backslash|IntlYen`(+12)
- フル：
  - 負：`KeyZ:-12, KeyX:-11, KeyC:-10, KeyV:-9, KeyB:-8, KeyN:-7, KeyM:-6, KeyA:-5, KeyS:-4, KeyD:-3, KeyF:-2`
  - 中央：`KeyG:0`
  - 正：`KeyH:+1, KeyJ:+2, KeyK:+3, KeyL:+4, Semicolon:+5, KeyY:+6, KeyU:+7, KeyI:+8, KeyO:+9, KeyP:+10, BracketRight:+11, Backslash|IntlYen:+12`

