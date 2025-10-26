// ==========================================
// 相対的キーボード - メインアプリケーション
// ==========================================

// グローバル状態
const state = {
  // 音楽的状態
  currentNote: 60,  // 現在のMIDIノート (C3)
  rootNote: 60,     // ルートノート (Anchorモード用)
  mode: 'follow',   // 'follow' | 'anchor'
  scale: 'chromatic', // 'chromatic' | 'major' | 'minor'

  // UI状態
  audioEnabled: true,  // デフォルトでON
  keyboardEnabled: true,

  // 履歴
  history: []
};

// 定数
const MIDI_MIN = 0;
const MIDI_MAX = 127;
const DEFAULT_NOTE = 60;

// スケール定義 (半音単位のインターバル)
const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10]
};

// MIDI番号から音名を取得
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ==========================================
// Web Audio API
// ==========================================

let audioContext = null;
let masterGain = null;
// 複数の音を管理するためのMap（キー: デルタ値、値: {oscillator, gainNode}）
const activeNotes = new Map();

// オーディオコンテキストの初期化
function initAudio() {
  if (audioContext) return;

  audioContext = new (window.AudioContext || window.webkitAudioContext)({
    latencyHint: 'interactive'
  });

  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.3;
  masterGain.connect(audioContext.destination);

  // レイテンシ表示
  updateLatency();
}

// レイテンシ表示の更新
function updateLatency() {
  if (audioContext) {
    const latency = audioContext.baseLatency * 1000;
    document.getElementById('latency').textContent = latency.toFixed(1);
  }
}

// ノートを再生（押している間だけ）- デルタ値も受け取る
function startNote(delta, midiNote) {
  if (!state.audioEnabled || !audioContext) return;

  // 既に同じデルタで音が鳴っている場合は停止してから再開
  if (activeNotes.has(delta)) {
    stopNote(delta);
  }

  // 周波数計算
  const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);

  // ピアノっぽい音を作るために複数のオシレーターを組み合わせ
  const oscillators = [];
  const gains = [];

  // 基本音（sine波でクリーンな音）
  const osc1 = audioContext.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = frequency;
  const gain1 = audioContext.createGain();
  gain1.gain.value = 0.6;
  oscillators.push(osc1);
  gains.push(gain1);

  // 第2倍音（やわらかい倍音）
  const osc2 = audioContext.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = frequency * 2;
  const gain2 = audioContext.createGain();
  gain2.gain.value = 0.3;
  oscillators.push(osc2);
  gains.push(gain2);

  // 第3倍音
  const osc3 = audioContext.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.value = frequency * 3;
  const gain3 = audioContext.createGain();
  gain3.gain.value = 0.15;
  oscillators.push(osc3);
  gains.push(gain3);

  // 第4倍音
  const osc4 = audioContext.createOscillator();
  osc4.type = 'sine';
  osc4.frequency.value = frequency * 4;
  const gain4 = audioContext.createGain();
  gain4.gain.value = 0.08;
  oscillators.push(osc4);
  gains.push(gain4);

  // メインゲインノード (ADSR用)
  const mainGainNode = audioContext.createGain();
  mainGainNode.gain.value = 0;

  // 接続
  oscillators.forEach((osc, i) => {
    osc.connect(gains[i]);
    gains[i].connect(mainGainNode);
  });
  mainGainNode.connect(masterGain);

  // ADSR エンベロープ (ピアノ風)
  const now = audioContext.currentTime;
  const attack = 0.01;    // 10ms - より速いアタック
  const decay = 0.1;      // 100ms
  const sustain = 0.7;    // 0.7 - 高めのサステイン
  const velocity = 0.5;   // 固定ベロシティ（やや控えめ）

  // Attack
  mainGainNode.gain.setValueAtTime(0, now);
  mainGainNode.gain.linearRampToValueAtTime(velocity, now + attack);

  // Decay to Sustain
  mainGainNode.gain.linearRampToValueAtTime(sustain * velocity, now + attack + decay);

  // 開始
  oscillators.forEach(osc => osc.start());

  // このデルタ値の音として保存
  activeNotes.set(delta, {
    oscillators: oscillators,
    gainNode: mainGainNode
  });
}

// 特定のデルタ値の音を停止
function stopNote(delta) {
  const note = activeNotes.get(delta);
  if (note && audioContext) {
    const now = audioContext.currentTime;
    const release = 0.15;  // 150ms - ピアノ風のリリース

    // Release
    note.gainNode.gain.cancelScheduledValues(now);
    note.gainNode.gain.setValueAtTime(note.gainNode.gain.value, now);
    note.gainNode.gain.exponentialRampToValueAtTime(0.001, now + release);

    // 停止
    note.oscillators.forEach(osc => osc.stop(now + release));

    // Mapから削除
    activeNotes.delete(delta);
  }
}

// すべての音を停止
function stopAllNotes() {
  activeNotes.forEach((note, delta) => {
    stopNote(delta);
  });
}

// ==========================================
// 音楽ロジック
// ==========================================

// スケールにクォンタイズ
function quantizeDelta(delta, scale, rootNote) {
  if (scale === 'chromatic') return delta;

  const scaleIntervals = SCALES[scale];
  const scaleLength = scaleIntervals.length;

  // デルタを度数に変換
  const sign = Math.sign(delta);
  const absDelta = Math.abs(delta);
  const octaves = Math.floor(absDelta / scaleLength);
  const degree = absDelta % scaleLength;

  // 実際の半音数を計算
  const semitones = octaves * 12 + scaleIntervals[degree];
  return semitones * sign;
}

// デルタ値から次のノートを計算
function calculateNextNote(delta) {
  // スケールクォンタイズ
  const quantizedDelta = quantizeDelta(delta, state.scale, state.rootNote);

  // モードに応じて計算
  let nextNote;
  if (state.mode === 'follow') {
    nextNote = state.currentNote + quantizedDelta;
  } else {  // anchor
    nextNote = state.rootNote + quantizedDelta;
  }

  // MIDI範囲にクランプ
  const clamped = Math.max(MIDI_MIN, Math.min(MIDI_MAX, nextNote));
  const wasClamped = nextNote !== clamped;

  return { note: clamped, clamped: wasClamped };
}

// ノートをトリガー（押した時）
function triggerNoteStart(delta) {
  // 履歴に追加
  state.history.push(state.currentNote);

  // 次のノートを計算
  const { note, clamped } = calculateNextNote(delta);

  // 状態更新
  state.currentNote = note;

  // 音を開始（デルタ値も渡す）
  startNote(delta, note);

  // UI更新
  updateDisplay();
  updateKeyboard();

  // クランプフィードバック
  if (clamped) {
    showClampFeedback();
  }

  // Undo有効化
  document.getElementById('undoBtn').disabled = state.history.length === 0;

  // ローカルストレージに保存
  saveState();
}

// ノートを停止（離した時）- デルタ値を指定
function triggerNoteStop(delta) {
  stopNote(delta);
}

// クランプフィードバックを表示
function showClampFeedback() {
  const keys = document.querySelectorAll('.key');
  keys.forEach(key => {
    if (key.classList.contains('active')) {
      key.classList.add('clamped');
      setTimeout(() => key.classList.remove('clamped'), 300);
    }
  });
}

// ==========================================
// UI更新
// ==========================================

// MIDI番号から音名を生成
function getNoteName(midiNote) {
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = NOTE_NAMES[midiNote % 12];
  return `${noteName}${octave}`;
}

// 黒鍵かどうかを判定
function isBlackKey(midiNote) {
  const noteInOctave = midiNote % 12;
  // C#, D#, F#, G#, A# が黒鍵
  return [1, 3, 6, 8, 10].includes(noteInOctave);
}

// 表示を更新
function updateDisplay() {
  const noteName = getNoteName(state.currentNote);
  document.getElementById('currentNote').textContent = `${noteName} (${state.currentNote})`;
  document.getElementById('currentMode').textContent = state.mode === 'follow' ? 'Follow' : 'Anchor';
  document.getElementById('currentScale').textContent =
    state.scale === 'chromatic' ? 'Chromatic' :
    state.scale === 'major' ? 'Major' : 'Minor';
  document.getElementById('currentRoot').textContent = getNoteName(state.rootNote);
}

// キーボードを生成
function createKeyboard() {
  const keyboard = document.getElementById('keyboard');
  keyboard.innerHTML = '';

  // キーボードマッピング
  const keyMap = {
    '-12': 'Z',
    '-11': 'X',
    '-10': 'C',
    '-9': 'V',
    '-8': 'B',
    '-7': 'N',
    '-6': 'M',
    '-5': 'A',
    '-4': 'S',
    '-3': 'D',
    '-2': 'F',
    '-1': 'G',
    '0': 'Space',
    '1': 'H',
    '2': 'J',
    '3': 'K',
    '4': 'L',
    '5': ';',
    '6': '\'',
    '7': '\\',
    '8': 'Y',
    '9': 'U',
    '10': 'I',
    '11': 'O',
    '12': 'P'
  };

  for (let delta = -12; delta <= 12; delta++) {
    const key = document.createElement('div');
    key.className = 'key';
    key.dataset.delta = delta;

    // 現在のモードでのターゲットノートを計算して黒鍵/白鍵を判定
    const { note } = calculateNextNote(delta);
    if (isBlackKey(note)) {
      key.classList.add('black-key');
    } else {
      key.classList.add('white-key');
    }

    if (delta === 0) {
      key.classList.add('center');
    }

    // デルタ表示（上部に配置）
    const deltaSpan = document.createElement('div');
    deltaSpan.className = 'key-delta';
    deltaSpan.textContent = delta > 0 ? `+${delta}` : delta.toString();

    // プレビューノート（下部に配置）
    const noteSpan = document.createElement('div');
    noteSpan.className = 'key-note';

    // キーボードショートカット
    const shortcut = keyMap[delta.toString()];
    if (shortcut) {
      const shortcutSpan = document.createElement('div');
      shortcutSpan.className = 'key-shortcut';
      shortcutSpan.textContent = shortcut;
      key.appendChild(shortcutSpan);
    }

    key.appendChild(deltaSpan);
    key.appendChild(noteSpan);
    keyboard.appendChild(key);

    // タッチ/クリックイベント
    key.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (e.isPrimary) {  // プライマリポインタのみ
        key.classList.add('active');
        key.dataset.pressed = 'true';  // 押下状態を記録
        triggerNoteStart(delta);
      }
    });

    key.addEventListener('pointerup', (e) => {
      if (key.dataset.pressed === 'true') {
        key.classList.remove('active');
        key.dataset.pressed = 'false';
        triggerNoteStop(delta);
      }
    });

    key.addEventListener('pointercancel', (e) => {
      if (key.dataset.pressed === 'true') {
        key.classList.remove('active');
        key.dataset.pressed = 'false';
        triggerNoteStop(delta);
      }
    });

    key.addEventListener('pointerleave', (e) => {
      if (key.dataset.pressed === 'true') {
        key.classList.remove('active');
        key.dataset.pressed = 'false';
        triggerNoteStop(delta);
      }
    });
  }

  updateKeyboard();
}

// キーボードの表示を更新
function updateKeyboard() {
  const keys = document.querySelectorAll('.key');
  keys.forEach(key => {
    const delta = parseInt(key.dataset.delta);
    const { note } = calculateNextNote(delta);

    // 黒鍵/白鍵のクラスを更新
    key.classList.remove('black-key', 'white-key');
    if (isBlackKey(note)) {
      key.classList.add('black-key');
    } else {
      key.classList.add('white-key');
    }

    const noteSpan = key.querySelector('.key-note');
    if (noteSpan) {
      noteSpan.textContent = getNoteName(note);
    }
  });
}

// ==========================================
// キーボード入力
// ==========================================

// キーコードとデルタのマッピング
const KEY_DELTA_MAP = {
  'Space': 0,
  'KeyZ': -12,
  'KeyX': -11,
  'KeyC': -10,
  'KeyV': -9,
  'KeyB': -8,
  'KeyN': -7,
  'KeyM': -6,
  'KeyA': -5,
  'KeyS': -4,
  'KeyD': -3,
  'KeyF': -2,
  'KeyG': -1,
  'KeyH': 1,
  'KeyJ': 2,
  'KeyK': 3,
  'KeyL': 4,
  'Semicolon': 5,
  'Quote': 6,
  'Backslash': 7,
  'KeyY': 8,
  'KeyU': 9,
  'KeyI': 10,
  'KeyO': 11,
  'KeyP': 12,
  'ArrowLeft': -1,
  'ArrowRight': 1,
  'ArrowDown': -12,
  'ArrowUp': 12
};

// 現在押されているキーを追跡（キーコード -> デルタ値のマッピング）
const pressedKeys = new Map();

// キーボードイベントハンドラ
document.addEventListener('keydown', (e) => {
  if (!state.keyboardEnabled) return;

  // 既に押されているキーは無視（リピート防止）
  if (pressedKeys.has(e.code)) return;

  // コントロールキー
  if (e.code === 'KeyR') {
    reset();
    return;
  }
  if (e.code === 'KeyQ') {
    toggleMode();
    return;
  }
  if (e.code === 'KeyW') {
    toggleScale();
    return;
  }

  // デルタキー
  const delta = KEY_DELTA_MAP[e.code];
  if (delta !== undefined) {
    e.preventDefault();
    pressedKeys.set(e.code, delta);  // キーコードとデルタ値を紐付けて保存

    // ビジュアルフィードバック
    const key = document.querySelector(`.key[data-delta="${delta}"]`);
    if (key) {
      key.classList.add('active');
    }

    triggerNoteStart(delta);
  }
});

// キーボードリリースイベント
document.addEventListener('keyup', (e) => {
  if (!state.keyboardEnabled) return;

  // このキーに対応するデルタ値を取得
  const delta = pressedKeys.get(e.code);

  if (delta !== undefined) {
    e.preventDefault();

    // 押されたキーの記録を削除
    pressedKeys.delete(e.code);

    // ビジュアルフィードバック解除
    const key = document.querySelector(`.key[data-delta="${delta}"]`);
    if (key) {
      key.classList.remove('active');
    }

    // このデルタ値の音を停止
    triggerNoteStop(delta);
  }
});

// ==========================================
// コントロール機能
// ==========================================

// リセット
function reset() {
  state.currentNote = DEFAULT_NOTE;
  state.history = [];
  stopAllNotes();  // すべての音を停止
  updateDisplay();
  updateKeyboard();
  document.getElementById('undoBtn').disabled = true;
  saveState();
}

// Undo
function undo() {
  if (state.history.length > 0) {
    state.currentNote = state.history.pop();
    stopAllNotes();  // すべての音を停止
    updateDisplay();
    updateKeyboard();
    document.getElementById('undoBtn').disabled = state.history.length === 0;
    saveState();
  }
}

// モード切り替え
function toggleMode() {
  state.mode = state.mode === 'follow' ? 'anchor' : 'follow';
  document.getElementById('modeToggle').textContent = `Mode: ${state.mode === 'follow' ? 'Follow' : 'Anchor'}`;
  updateDisplay();
  updateKeyboard();
  saveState();
}

// スケール切り替え
function toggleScale() {
  const scales = ['chromatic', 'major', 'minor'];
  const currentIndex = scales.indexOf(state.scale);
  state.scale = scales[(currentIndex + 1) % scales.length];

  const scaleNames = { chromatic: 'Chromatic', major: 'Major', minor: 'Minor' };
  document.getElementById('scaleToggle').textContent = `Scale: ${scaleNames[state.scale]}`;
  updateDisplay();
  updateKeyboard();
  saveState();
}

// ルートノート変更
function changeRoot(midiNote) {
  state.rootNote = parseInt(midiNote);
  updateDisplay();
  updateKeyboard();
  saveState();
}

// オーディオ切り替え
function toggleAudio() {
  if (!state.audioEnabled) {
    initAudio();
    state.audioEnabled = true;
    document.getElementById('audioToggle').textContent = '🔊 Audio ON';
    document.getElementById('audioToggle').classList.add('audio-on');
  } else {
    stopCurrentNote();
    state.audioEnabled = false;
    document.getElementById('audioToggle').textContent = '🔇 Audio OFF';
    document.getElementById('audioToggle').classList.remove('audio-on');
  }
  saveState();
}

// キーボード入力切り替え
function toggleKeyboard() {
  state.keyboardEnabled = !state.keyboardEnabled;
  document.getElementById('keyboardToggle').textContent =
    `⌨️ Keyboard: ${state.keyboardEnabled ? 'ON' : 'OFF'}`;
  saveState();
}

// ==========================================
// ローカルストレージ
// ==========================================

// 状態を保存
function saveState() {
  const savedState = {
    mode: state.mode,
    scale: state.scale,
    rootNote: state.rootNote,
    keyboardEnabled: state.keyboardEnabled
  };
  localStorage.setItem('relativeKeyboardState', JSON.stringify(savedState));
}

// 状態を読み込み
function loadState() {
  const saved = localStorage.getItem('relativeKeyboardState');
  if (saved) {
    const savedState = JSON.parse(saved);
    state.mode = savedState.mode || 'follow';
    state.scale = savedState.scale || 'chromatic';
    state.rootNote = savedState.rootNote || 60;
    state.keyboardEnabled = savedState.keyboardEnabled !== undefined ? savedState.keyboardEnabled : true;
    // audioEnabledは保存された値を無視して常にtrueにする
    // state.audioEnabled = savedState.audioEnabled !== undefined ? savedState.audioEnabled : true;

    // UI更新
    document.getElementById('modeToggle').textContent = `Mode: ${state.mode === 'follow' ? 'Follow' : 'Anchor'}`;
    const scaleNames = { chromatic: 'Chromatic', major: 'Major', minor: 'Minor' };
    document.getElementById('scaleToggle').textContent = `Scale: ${scaleNames[state.scale]}`;
    document.getElementById('rootSelect').value = state.rootNote;
    document.getElementById('keyboardToggle').textContent =
      `⌨️ Keyboard: ${state.keyboardEnabled ? 'ON' : 'OFF'}`;
  }
}

// ==========================================
// 初期化
// ==========================================

// DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  // 状態を読み込み
  loadState();

  // オーディオ初期化（保存された状態に応じて）
  if (state.audioEnabled) {
    initAudio();
    document.getElementById('audioToggle').textContent = '🔊 Audio ON';
    document.getElementById('audioToggle').classList.add('audio-on');
  }

  // キーボード生成
  createKeyboard();

  // 初期表示
  updateDisplay();

  // イベントリスナー設定
  document.getElementById('audioToggle').addEventListener('click', toggleAudio);
  document.getElementById('modeToggle').addEventListener('click', toggleMode);
  document.getElementById('scaleToggle').addEventListener('click', toggleScale);
  document.getElementById('rootSelect').addEventListener('change', (e) => changeRoot(e.target.value));
  document.getElementById('resetBtn').addEventListener('click', reset);
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('keyboardToggle').addEventListener('click', toggleKeyboard);

  // タッチアクション無効化（スクロール防止）
  document.getElementById('keyboard').style.touchAction = 'none';
});