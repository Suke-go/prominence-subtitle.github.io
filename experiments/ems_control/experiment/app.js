/**
 * EMS Experiment — Playback-Only Application
 *
 * Features:
 * - Stereo WAV playback (L=Audio, R=EMS) with dual-port routing
 * - Session/condition/trial management
 * - Event logging with JSON export
 * - Extensible questionnaire plugin system
 */

'use strict';

// ═══════════════════════════════════════════════════════════
// EMSExperimentApp
// ═══════════════════════════════════════════════════════════

class EMSExperimentApp {
  constructor() {
    this.els = {};

    // ── Session ──
    this.participantId = '';
    this.conditionId = 'ems_on';
    this.trialCurrent = 1;
    this.trialTotal = 4;

    // ── Playback ──
    this._audioL = null;
    this._audioR = null;
    this._playbackDuration = 0;
    this._playbackReady = false;
    this._seekAnimFrame = null;
    this._currentFileName = '';

    // ── Log ──
    this.eventLog = [];
    this.sessionStartTime = null;

    // ── Questionnaire plugins ──
    this._questionnairePlugins = [];
  }

  // ═══════════════════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════════════════

  async init() {
    this._cacheDom();
    this._bindControls();
    await this._refreshDevices();
    await this._loadMediaLibrary();
    this._loadBuiltinQuestionnaire();
    this._log('system', 'Experiment environment initialized');
    console.log('[Experiment] Ready');
  }

  _cacheDom() {
    const $ = id => document.getElementById(id);
    this.els = {
      participantId: $('participantId'),
      conditionId: $('conditionId'),
      trialCurrent: $('trialCurrent'),
      trialTotal: $('trialTotal'),
      sessionStatus: $('sessionStatus'),
      audioPort: $('audioPort'),
      emsPort: $('emsPort'),
      refreshDevices: $('refreshDevices'),
      mediaLibrary: $('mediaLibrary'),
      dropZone: $('dropZone'),
      fileInput: $('fileInput'),
      fileName: $('fileName'),
      btnPlay: $('btnPlay'),
      btnPause: $('btnPause'),
      btnStop: $('btnStop'),
      seekBar: $('seekBar'),
      timeDisp: $('timeDisp'),
      btnNextTrial: $('btnNextTrial'),
      btnExport: $('btnExport'),
      btnReset: $('btnReset'),
      questionnaireContainer: $('questionnaireContainer'),
      qPlaceholder: $('qPlaceholder'),
      logToggle: $('logToggle'),
      logBody: $('logBody'),
      logPanel: $('logPanel'),
      logEntries: $('logEntries'),
      statEvents: $('statEvents'),
      statDuration: $('statDuration'),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Controls
  // ═══════════════════════════════════════════════════════════

  _bindControls() {
    // Session
    this.els.participantId.addEventListener('input', e => {
      this.participantId = e.target.value.trim();
    });
    this.els.conditionId.addEventListener('change', e => {
      this.conditionId = e.target.value;
      this._log('condition', `Condition changed: ${this.conditionId}`);
    });
    this.els.trialTotal.addEventListener('input', e => {
      this.trialTotal = Math.max(1, parseInt(e.target.value) || 1);
    });

    // Devices
    this.els.refreshDevices.addEventListener('click', () => this._refreshDevices());

    // Transport
    this.els.btnPlay.addEventListener('click', () => this._play());
    this.els.btnPause.addEventListener('click', () => this._pause());
    this.els.btnStop.addEventListener('click', () => this._stop());
    this.els.seekBar.addEventListener('input', e => {
      if (!this._audioL) return;
      const t = (parseInt(e.target.value) / 1000) * this._playbackDuration;
      this._audioL.currentTime = t;
      if (this._audioR) this._audioR.currentTime = t;
    });

    // Drop zone
    this.els.dropZone.addEventListener('click', () => this.els.fileInput.click());
    this.els.dropZone.addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); });
    this.els.dropZone.addEventListener('dragleave', e => e.currentTarget.classList.remove('dragover'));
    this.els.dropZone.addEventListener('drop', e => {
      e.preventDefault();
      e.currentTarget.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this._loadFile(e.dataTransfer.files[0]);
    });
    this.els.fileInput.addEventListener('change', e => {
      if (e.target.files[0]) this._loadFile(e.target.files[0]);
    });

    // Actions
    this.els.btnNextTrial.addEventListener('click', () => this._nextTrial());
    this.els.btnExport.addEventListener('click', () => this._exportLog());
    this.els.btnReset.addEventListener('click', () => this._reset());

    // Log toggle
    this.els.logToggle.addEventListener('click', () => {
      const open = this.els.logBody.style.display !== 'none';
      this.els.logBody.style.display = open ? 'none' : 'block';
      this.els.logPanel.classList.toggle('open', !open);
    });

    // Keyboard
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); this._playbackReady ? (this._audioL?.paused ? this._play() : this._pause()) : null; }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Devices
  // ═══════════════════════════════════════════════════════════

  async _refreshDevices() {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
      const devs = await navigator.mediaDevices.enumerateDevices();
      const outs = devs.filter(d => d.kind === 'audiooutput');
      [this.els.audioPort, this.els.emsPort].forEach(sel => {
        const prev = sel.value;
        sel.innerHTML = '';
        outs.forEach(d => {
          const o = document.createElement('option');
          o.value = d.deviceId;
          o.textContent = d.label || `Device ${d.deviceId.slice(0, 8)}`;
          sel.appendChild(o);
        });
        if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
      });
      console.log(`[Experiment] ${outs.length} output devices`);
    } catch (e) {
      console.warn('[Experiment] Device enumeration failed:', e);
    }
  }

  async _applyPorts() {
    try {
      if (this._audioL?.setSinkId) await this._audioL.setSinkId(this.els.audioPort?.value || 'default');
      if (this._audioR?.setSinkId) await this._audioR.setSinkId(this.els.emsPort?.value || 'default');
    } catch (e) {
      console.warn('[Experiment] setSinkId failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Media Library
  // ═══════════════════════════════════════════════════════════

  async _loadMediaLibrary() {
    const lib = this.els.mediaLibrary;
    try {
      const res = await fetch('../media/manifest.json');
      if (!res.ok) { lib.innerHTML = '<div class="media-lib__loading">No media found</div>'; return; }
      const manifest = await res.json();
      const files = manifest.files || [];
      if (!files.length) { lib.innerHTML = '<div class="media-lib__loading">Empty</div>'; return; }

      lib.innerHTML = '';
      files.forEach(f => {
        const tr = document.createElement('div');
        tr.className = 'media-track';
        tr.dataset.filename = f.name;
        tr.innerHTML = `
          <span class="media-track__icon">🎵</span>
          <div class="media-track__info">
            <div class="media-track__label">${f.label || f.name}</div>
            <div class="media-track__meta">${this._fmtTime(f.duration_s || 0)} ・ ${f.size_mb || '?'} MB</div>
          </div>
        `;
        tr.addEventListener('click', () => this._loadServerFile(f.name, f.label || f.name));
        lib.appendChild(tr);
      });
    } catch (e) {
      lib.innerHTML = '<div class="media-lib__loading">manifest.json not found</div>';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // File Loading
  // ═══════════════════════════════════════════════════════════

  async _loadServerFile(filename, label) {
    this._stop();
    this._setStatus('Loading...', '');
    this.els.fileName.textContent = label || filename;
    this._currentFileName = filename;

    // Highlight
    this.els.mediaLibrary.querySelectorAll('.media-track').forEach(t =>
      t.classList.toggle('media-track--active', t.dataset.filename === filename)
    );

    try {
      const res = await fetch(`../media/${filename}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this._decodeAndSetup(await res.arrayBuffer(), label || filename);
      this._log('load', `Loaded: ${filename}`);
    } catch (e) {
      console.error('[Experiment] Load error:', e);
      this._setStatus('Load failed', 'error');
    }
  }

  async _loadFile(file) {
    if (!file.name.toLowerCase().endsWith('.wav')) { alert('WAVファイルを選択してください'); return; }
    this._stop();
    this._setStatus('Decoding...', '');
    this.els.fileName.textContent = file.name;
    this._currentFileName = file.name;

    try {
      await this._decodeAndSetup(await file.arrayBuffer(), file.name);
      this._log('load', `Loaded (local): ${file.name}`);
    } catch (e) {
      console.error('[Experiment] Decode error:', e);
      alert('WAVデコード失敗');
    }
  }

  async _decodeAndSetup(arrayBuf, label) {
    const offCtx = new OfflineAudioContext(2, 1, 48000);
    const buf = await offCtx.decodeAudioData(arrayBuf);

    if (buf.numberOfChannels < 2) {
      alert('ステレオWAVが必要です (L=Audio, R=EMS)');
      return;
    }

    this._playbackDuration = buf.duration;
    const sr = buf.sampleRate;
    const blobL = this._createMonoWav(buf.getChannelData(0), sr);
    const blobR = this._createMonoWav(buf.getChannelData(1), sr);

    this._audioL = new Audio();
    this._audioR = new Audio();
    await this._applyPorts();

    const waitReady = (audio, url) => new Promise(res => {
      audio.addEventListener('canplay', res, { once: true });
      audio.src = url;
      audio.load();
    });

    await Promise.all([
      waitReady(this._audioL, URL.createObjectURL(blobL)),
      waitReady(this._audioR, URL.createObjectURL(blobR)),
    ]);

    this._audioL.currentTime = 0;
    this._audioR.currentTime = 0;
    this.els.seekBar.value = 0;
    this.els.timeDisp.textContent = `0:00 / ${this._fmtTime(this._playbackDuration)}`;
    this._playbackReady = true;
    this._setStatus('Ready', 'ready');
  }

  // ═══════════════════════════════════════════════════════════
  // Transport
  // ═══════════════════════════════════════════════════════════

  _play() {
    if (!this._playbackReady) return;
    if (this._audioL.duration && this._audioL.currentTime >= this._audioL.duration - 0.1) {
      this._audioL.currentTime = 0;
      this._audioR.currentTime = 0;
    }
    this._audioL.play().catch(() => {});
    this._audioR.play().catch(() => {});
    this._setStatus('Playing', 'recording');
    this._startSeekUpdate();

    if (!this.sessionStartTime) this.sessionStartTime = Date.now();
    this._log('playback', `Play: ${this._currentFileName} (cond=${this.conditionId})`);

    // Auto-stop at end → show questionnaire
    this._audioL.onended = () => {
      this._setStatus('再生完了', 'ready');
      this._log('playback', 'Playback ended');
      this._stopSeekUpdate();
      this._showQuestionnaire();
    };
  }

  _pause() {
    if (!this._playbackReady) return;
    this._audioL.pause();
    this._audioR.pause();
    this._setStatus('Paused', '');
    this._stopSeekUpdate();
    this._log('playback', 'Pause');
  }

  _stop() {
    if (!this._playbackReady) return;
    this._audioL.pause();
    this._audioR.pause();
    this._audioL.currentTime = 0;
    this._audioR.currentTime = 0;
    this.els.seekBar.value = 0;
    this.els.timeDisp.textContent = `0:00 / ${this._fmtTime(this._playbackDuration)}`;
    this._setStatus('Stopped', '');
    this._stopSeekUpdate();
  }

  _startSeekUpdate() {
    this._stopSeekUpdate();
    const tick = () => {
      const t = this._audioL.currentTime || 0;
      const d = this._playbackDuration || 1;
      this.els.seekBar.value = (t / d * 1000) | 0;
      this.els.timeDisp.textContent = `${this._fmtTime(t)} / ${this._fmtTime(d)}`;
      if (Math.abs(this._audioR.currentTime - t) > 0.1) this._audioR.currentTime = t;
      if (!this._audioL.paused) this._seekAnimFrame = requestAnimationFrame(tick);
    };
    this._seekAnimFrame = requestAnimationFrame(tick);
  }

  _stopSeekUpdate() {
    if (this._seekAnimFrame) { cancelAnimationFrame(this._seekAnimFrame); this._seekAnimFrame = null; }
  }

  // ═══════════════════════════════════════════════════════════
  // Questionnaire System
  // ═══════════════════════════════════════════════════════════

  /**
   * Register a questionnaire plugin.
   * Plugin interface: { name, render(container), collect() → Object }
   */
  registerQuestionnaire(plugin) {
    this._questionnairePlugins.push(plugin);
    console.log(`[Experiment] Questionnaire registered: ${plugin.name}`);
  }

  _loadBuiltinQuestionnaire() {
    // Built-in Likert questionnaire
    this.registerQuestionnaire({
      name: 'builtin_likert',
      render(container) {
        container.innerHTML = `
          <div class="q-group">
            <div class="q-label">Q1. 提示された刺激の強さは適切でしたか？</div>
            <div class="q-scale" data-q="q1_intensity">
              ${[1,2,3,4,5,6,7].map(v =>
                `<label><input type="radio" name="q1_intensity" value="${v}"><span class="q-opt">${v}</span></label>`
              ).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.55rem;color:#555;margin-top:2px">
              <span>弱すぎる</span><span>適切</span><span>強すぎる</span>
            </div>
          </div>
          <div class="q-group">
            <div class="q-label">Q2. 音声の鑑賞体験を補助していると感じましたか？</div>
            <div class="q-scale" data-q="q2_enhancement">
              ${[1,2,3,4,5,6,7].map(v =>
                `<label><input type="radio" name="q2_enhancement" value="${v}"><span class="q-opt">${v}</span></label>`
              ).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.55rem;color:#555;margin-top:2px">
              <span>まったく感じない</span><span>非常に感じる</span>
            </div>
          </div>
          <div class="q-group">
            <div class="q-label">Q3. 自由記述</div>
            <textarea class="q-textarea" data-q="q3_freetext" placeholder="感想・気づいた点をお書きください"></textarea>
          </div>
        `;
      },
      collect() {
        const data = {};
        document.querySelectorAll('[data-q]').forEach(el => {
          const q = el.dataset.q;
          if (el.tagName === 'TEXTAREA') {
            data[q] = el.value;
          } else {
            const checked = el.querySelector('input:checked');
            data[q] = checked ? parseInt(checked.value) : null;
          }
        });
        return data;
      }
    });
  }

  _showQuestionnaire() {
    const container = this.els.questionnaireContainer;
    if (this.els.qPlaceholder) this.els.qPlaceholder.style.display = 'none';

    // Render all plugins
    container.innerHTML = '';
    this._questionnairePlugins.forEach(p => {
      const div = document.createElement('div');
      div.className = 'questionnaire-plugin';
      div.dataset.plugin = p.name;
      p.render(div);
      container.appendChild(div);
    });

    // Scroll into view
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _collectQuestionnaireData() {
    const data = {};
    this._questionnairePlugins.forEach(p => {
      data[p.name] = p.collect();
    });
    return data;
  }

  // ═══════════════════════════════════════════════════════════
  // Trial Management
  // ═══════════════════════════════════════════════════════════

  _nextTrial() {
    // Collect questionnaire before advancing
    const qData = this._collectQuestionnaireData();
    this._log('questionnaire', JSON.stringify(qData));

    this._log('trial_end', `Trial ${this.trialCurrent} complete`);

    if (this.trialCurrent >= this.trialTotal) {
      this._setStatus('全試行完了', 'ready');
      this._log('session', 'All trials complete');
      alert(`全 ${this.trialTotal} 試行が完了しました。\n「ログ出力」でデータをダウンロードしてください。`);
      return;
    }

    this.trialCurrent++;
    this.els.trialCurrent.textContent = this.trialCurrent;
    this._stop();

    // Clear questionnaire
    this.els.questionnaireContainer.innerHTML = '';
    if (this.els.qPlaceholder) {
      this.els.qPlaceholder.style.display = '';
      this.els.questionnaireContainer.appendChild(this.els.qPlaceholder);
    }

    this._setStatus(`Trial ${this.trialCurrent}/${this.trialTotal}`, '');
    this._log('trial_start', `Trial ${this.trialCurrent} started`);
  }

  // ═══════════════════════════════════════════════════════════
  // Logging + Export
  // ═══════════════════════════════════════════════════════════

  _log(type, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      elapsed_ms: this.sessionStartTime ? Date.now() - this.sessionStartTime : 0,
      participant: this.participantId,
      condition: this.conditionId,
      trial: this.trialCurrent,
      type,
      message,
    };
    this.eventLog.push(entry);

    // Update UI
    this.els.statEvents.textContent = this.eventLog.length;
    if (this.sessionStartTime) {
      this.els.statDuration.textContent = this._fmtTime((Date.now() - this.sessionStartTime) / 1000);
    }

    // Add to log entries
    const logEl = this.els.logEntries;
    const placeholder = logEl.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();

    const row = document.createElement('div');
    row.className = 'log-entry';
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    row.innerHTML = `<span class="log-entry__time">${time}</span><span class="log-entry__event">[${type}] ${message}</span>`;
    logEl.appendChild(row);
    while (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  _exportLog() {
    // Collect final questionnaire if visible
    const qData = this._collectQuestionnaireData();
    if (Object.keys(qData).length > 0) {
      this._log('questionnaire_final', JSON.stringify(qData));
    }

    const data = {
      exported_at: new Date().toISOString(),
      participant: this.participantId,
      condition: this.conditionId,
      trials_completed: this.trialCurrent,
      trials_total: this.trialTotal,
      events: this.eventLog,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `ems_exp_${this.participantId || 'unknown'}_${this.conditionId}_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this._log('export', `Log exported (${this.eventLog.length} events)`);
  }

  _reset() {
    if (!confirm('セッションをリセットしますか？ログは失われます。')) return;
    this._stop();
    this.eventLog = [];
    this.trialCurrent = 1;
    this.sessionStartTime = null;
    this.els.trialCurrent.textContent = '1';
    this.els.statEvents.textContent = '0';
    this.els.statDuration.textContent = '0:00';
    this.els.logEntries.innerHTML = '<div class="log-placeholder">待機中...</div>';
    this.els.questionnaireContainer.innerHTML = '';
    if (this.els.qPlaceholder) {
      this.els.qPlaceholder.style.display = '';
      this.els.questionnaireContainer.appendChild(this.els.qPlaceholder);
    }
    this._setStatus('待機中', '');
    console.log('[Experiment] Session reset');
  }

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

  _setStatus(text, mode) {
    const chip = this.els.sessionStatus;
    const dot = chip.querySelector('.status-chip__dot');
    const txt = chip.querySelector('.status-chip__text');
    dot.className = `status-chip__dot ${mode || ''}`;
    txt.textContent = text;
  }

  _fmtTime(s) {
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  _createMonoWav(channelData, sr) {
    const n = channelData.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const ws = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, channelData[i])) * 32767, true);
    return new Blob([buf], { type: 'audio/wav' });
  }
}

// ═══════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  window.experiment = new EMSExperimentApp();
  window.experiment.init();
});
