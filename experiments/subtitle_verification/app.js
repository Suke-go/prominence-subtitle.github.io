/**
 * Prosodic Captioning Experiment — ExperimentRunner
 *
 * Full experiment flow:
 *  Consent → Demographics → Practice → 6 Trials → Post-Survey → Complete
 *
 * Features:
 *  - Balanced Latin Square condition assignment (hash of participant ID → pattern A-D)
 *  - High/low alternating presentation order
 *  - Live-captioning-style subtitle overlay synced to video currentTime
 *  - Condition-dependent font-size/weight from subtitle.json
 *  - Comprehension quiz + speaker intent tasks + subjective ratings
 *  - Full data export to JSON
 */

'use strict';

class ExperimentRunner {
  constructor() {
    this.config = null;
    this.participantId = '';
    this.pattern = '';
    this.trialOrder = [];
    this.currentTrialIdx = 0;
    this.data = { demographics: {}, trials: [], postSurvey: {} };
    this.startTime = null;

    // Subtitle state
    this._subtitleData = null;
    this._currentCondition = '';
    this._rafId = null;
    this._lastChunkIdx = -1;
  }

  // ═════════════════════════════════════════════════════
  // Init
  // ═════════════════════════════════════════════════════

  async init() {
    // Debug mode: ?debug=1 shows condition switcher + video controls
    this.debugMode = new URLSearchParams(window.location.search).has('debug');

    try {
      const res = await fetch('experiment_config.json');
      this.config = await res.json();
    } catch (e) {
      console.error('[Experiment] Failed to load config:', e);
      return;
    }
    this._bindPhaseControls();
    this._addProgressBar();

    if (this.debugMode) {
      document.getElementById('debugBar')?.classList.remove('hidden');
      console.log('[Experiment] Debug mode ON — condition switcher visible');
    }
    console.log('[Experiment] Initialized');
  }

  _addProgressBar() {
    const bar = document.createElement('div');
    bar.className = 'progress';
    bar.innerHTML = '<div class="progress__fill" id="progressFill"></div>';
    document.body.prepend(bar);
  }

  _updateProgress(fraction) {
    const fill = document.getElementById('progressFill');
    if (fill) fill.style.width = `${(fraction * 100).toFixed(1)}%`;
  }

  // ═════════════════════════════════════════════════════
  // Phase Navigation
  // ═════════════════════════════════════════════════════

  _showPhase(id) {
    document.querySelectorAll('.phase').forEach(p => p.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) { el.classList.remove('hidden'); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  // ═════════════════════════════════════════════════════
  // Phase Controls
  // ═════════════════════════════════════════════════════

  _bindPhaseControls() {
    const $ = id => document.getElementById(id);

    // Consent
    const consentCheck = $('consentCheck');
    const inputPid = $('inputParticipantId');
    const btnConsent = $('btnConsent');
    const updateConsent = () => {
      btnConsent.disabled = !(consentCheck.checked && inputPid.value.trim().length >= 3);
    };
    consentCheck.addEventListener('change', updateConsent);
    inputPid.addEventListener('input', updateConsent);
    btnConsent.addEventListener('click', () => this._onConsent());

    // Demographics
    $('btnDemographics').addEventListener('click', () => this._onDemographics());

    // Practice
    $('btnStartPractice').addEventListener('click', () => this._startPractice());
    $('btnEndPractice').addEventListener('click', () => this._startTrials());

    // Trial sub-phase buttons
    $('btnSubmitQuiz').addEventListener('click', () => this._onSubmitQuiz());
    $('btnSubmitIntent').addEventListener('click', () => this._onSubmitIntent());
    $('btnSubmitSubjective').addEventListener('click', () => this._onSubmitSubjective());

    // Post-survey
    $('postNoticeDiff').addEventListener('change', e => {
      $('postNoticeDiffDetail').style.display = e.target.value === 'yes' ? 'flex' : 'none';
    });
    $('btnPostSurvey').addEventListener('click', () => this._onPostSurvey());

    // Complete
    $('btnDownloadData').addEventListener('click', () => this._downloadData());
  }

  // ═════════════════════════════════════════════════════
  // Consent → Assignment
  // ═════════════════════════════════════════════════════

  _onConsent() {
    this.participantId = document.getElementById('inputParticipantId').value.trim();
    this.startTime = Date.now();

    // Latin Square assignment
    this.pattern = this._assignPattern(this.participantId);
    this.trialOrder = this._generateOrder();

    console.log(`[Experiment] Participant: ${this.participantId}, Pattern: ${this.pattern}`);
    console.log(`[Experiment] Trial order:`, this.trialOrder.map(t => `${t.clip}(${t.condition})`));

    this._updateProgress(0.05);
    this._showPhase('phaseDemographics');
  }

  /**
   * FNV-1a hash → pattern A-D
   */
  _assignPattern(pid) {
    let h = 0x811c9dc5;
    for (let i = 0; i < pid.length; i++) {
      h ^= pid.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h = h >>> 0; // unsigned
    const patterns = Object.keys(this.config.latin_square);
    return patterns[h % patterns.length];
  }

  /**
   * Generate presentation order: high/low alternating, randomized within group
   */
  _generateOrder() {
    const clipInfo = this.config.clips;
    const ls = this.config.latin_square[this.pattern];

    const high = Object.keys(clipInfo).filter(c => clipInfo[c].group === 'high');
    const low = Object.keys(clipInfo).filter(c => clipInfo[c].group === 'low');

    this._shuffle(high);
    this._shuffle(low);

    // Interleave: H, L, H, L, H, L
    const order = [];
    const len = Math.max(high.length, low.length);
    for (let i = 0; i < len; i++) {
      if (i < high.length) order.push({ clip: high[i], condition: ls[high[i]] });
      if (i < low.length) order.push({ clip: low[i], condition: ls[low[i]] });
    }
    return order;
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ═════════════════════════════════════════════════════
  // Demographics
  // ═════════════════════════════════════════════════════

  _onDemographics() {
    const $ = id => document.getElementById(id)?.value || '';
    this.data.demographics = {
      age_range: $('demoAge'),
      gender: $('demoGender'),
      native_language: $('demoNativeLang'),
      subtitle_frequency: parseInt($('demoSubFreq')) || null,
    };
    this._updateProgress(0.1);
    this._showPhase('phasePractice');
  }

  // ═════════════════════════════════════════════════════
  // Practice
  // ═════════════════════════════════════════════════════

  async _startPractice() {
    document.getElementById('btnStartPractice').classList.add('hidden');
    // For practice, use first clip with Normal condition if available
    const firstClip = Object.keys(this.config.clips)[0];
    try {
      await this._loadSubtitleData(firstClip);
      const video = document.getElementById('practiceVideo');
      video.src = `../subtitle_study/demo_data/${firstClip}/video.mp4`;
      video.load();
      video.oncanplay = () => {
        video.play().catch(() => {});
        this._startSubtitleSync(video, document.getElementById('practiceSubtitleText'), 'normal');
      };
      video.onended = () => {
        this._stopSubtitleSync();
        document.getElementById('btnEndPractice').classList.remove('hidden');
      };
      // Fallback: if no video, show button after 3s
      setTimeout(() => {
        document.getElementById('btnEndPractice').classList.remove('hidden');
      }, 5000);
    } catch (e) {
      console.warn('[Experiment] Practice clip not available:', e);
      document.getElementById('btnEndPractice').classList.remove('hidden');
    }
  }

  // ═════════════════════════════════════════════════════
  // Trials
  // ═════════════════════════════════════════════════════

  _startTrials() {
    this.currentTrialIdx = 0;
    this._showPhase('phaseTrial');
    this._runCurrentTrial();
  }

  async _runCurrentTrial() {
    if (this.currentTrialIdx >= this.trialOrder.length) {
      this._showPhase('phasePostSurvey');
      this._updateProgress(0.85);
      return;
    }

    const trial = this.trialOrder[this.currentTrialIdx];
    const progress = 0.15 + (this.currentTrialIdx / this.trialOrder.length) * 0.7;
    this._updateProgress(progress);

    document.getElementById('clipIndicator').textContent =
      `Clip ${this.currentTrialIdx + 1} of ${this.trialOrder.length}`;

    // Load subtitle data
    try {
      await this._loadSubtitleData(trial.clip);
    } catch (e) {
      console.error(`[Experiment] Subtitle data load failed for ${trial.clip}:`, e);
    }

    // Show video sub-phase (full page — quiz etc are hidden)
    this._showTrialSub('trialVideo');

    const video = document.getElementById('trialVideoEl');
    video.src = `../subtitle_study/demo_data/${trial.clip}/video.mp4`;
    video.load();

    // Populate debug bar
    this._populateDebugBar(trial.condition);

    // Prevent duplicate event handlers
    video.oncanplay = null;
    video.onended = null;

    const onCanPlay = () => {
      video.removeEventListener('canplay', onCanPlay);
      video.play().catch(() => {});
      this._startSubtitleSync(video, document.getElementById('trialSubtitleText'), trial.condition);
    };
    video.addEventListener('canplay', onCanPlay);

    video.onended = () => {
      this._stopSubtitleSync();
      // Show "Proceed" button overlay — clicking switches to a SEPARATE quiz page
      this._showProceedButton(trial.clip);
    };

    // Disable user controls in production (no pause/seek per exp_design)
    video.controls = this.debugMode;
  }

  /**
   * Show a "Proceed to Questions" button after video ends.
   * Clicking switches to a completely separate page (video disappears).
   */
  _showProceedButton(clipId) {
    const wrapper = document.getElementById('trialVideoWrapper');
    wrapper.querySelector('.proceed-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'proceed-overlay';
    overlay.innerHTML = `
      <div class="proceed-content">
        <p class="proceed-msg">Video complete</p>
        <button class="btn btn--primary btn--lg" id="btnProceedToQuiz">Proceed to Questions →</button>
      </div>
    `;
    wrapper.appendChild(overlay);

    document.getElementById('btnProceedToQuiz').addEventListener('click', () => {
      overlay.remove();
      // Full page switch — video section disappears entirely
      this._showQuiz(clipId);
    });
  }

  /**
   * Show a trial sub-phase as a full separate page.
   * Scrolls to top so participant sees a clean new page.
   */
  _showTrialSub(id) {
    document.querySelectorAll('.trial-sub').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  _populateDebugBar(condition) {
    const sel = document.getElementById('debugCondition');
    if (!sel) return;
    sel.innerHTML = '';
    this.config.conditions.forEach(c => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = this.config.condition_labels[c] || c;
      o.selected = (c === condition);
      sel.appendChild(o);
    });
    sel.onchange = e => {
      this._currentCondition = e.target.value;
    };
    const offCb = document.getElementById('debugSubOff');
    if (offCb) offCb.onchange = e => {
      document.getElementById('trialSubtitleText').style.display = e.target.checked ? 'none' : '';
    };
  }

  // ═════════════════════════════════════════════════════
  // Subtitle Overlay (Live Captioning)
  // ═════════════════════════════════════════════════════

  async _loadSubtitleData(clipId) {
    const res = await fetch(`../subtitle_study/demo_data/${clipId}/subtitle.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this._subtitleData = await res.json();
  }

  _startSubtitleSync(video, textEl, condition) {
    this._currentCondition = condition;
    this._lastChunkIdx = -1;

    const words = this._subtitleData?.conditions?.[condition];
    if (!words || !words.length) {
      textEl.innerHTML = '';
      return;
    }

    const chunkIntervalS = (this.config.presentation.subtitle_update_interval_ms || 500) / 1000;

    const tick = () => {
      const t = video.currentTime;
      const cond = this._currentCondition; // allow debug switching
      const condWords = this._subtitleData?.conditions?.[cond];
      if (!condWords) { this._rafId = requestAnimationFrame(tick); return; }

      // Find words visible at current time — show words that have started by t
      // Group into chunks of ~chunkIntervalS
      const chunkIdx = Math.floor(t / chunkIntervalS);

      if (chunkIdx !== this._lastChunkIdx) {
        this._lastChunkIdx = chunkIdx;

        // Find words in current time window (2s lookback — ~7-13 visible words,
        // comparable to Dynamik's chunk-based update)
        const windowStart = Math.max(0, t - 2);
        const windowEnd = t + 0.1;

        const visible = condWords.filter(w => w.start <= windowEnd && w.end >= windowStart);

        // Render as live-captioning style spans
        if (visible.length > 0) {
          textEl.innerHTML = visible.map(w => {
            // Scale up subtitle.json sizes for screen readability
            // Pipeline produces 3-tier: 12pt(low) / 15pt(mid) / 18pt(high)
            const size = Math.round((w.font_size || 18) * 1.2);
            const weight = w.font_weight || 400;
            // Opacity: words just appearing fade in
            const age = t - w.start;
            const opacity = Math.min(1, age / 0.3);
            return `<span class="word" style="font-size:${size}px;font-weight:${weight};opacity:${opacity.toFixed(2)}">${w.text} </span>`;
          }).join('');
        } else {
          textEl.innerHTML = '';
        }
      }

      if (!video.paused && !video.ended) {
        this._rafId = requestAnimationFrame(tick);
      }
    };

    this._rafId = requestAnimationFrame(tick);
  }

  _stopSubtitleSync() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  /**
   * Map subtitle.json 3-tier font values to dramatically stepped sizes.
   *
   * Input tiers from pipeline (step7_generate_subtitles.py):
   *   Low:  font_size=12, font_weight=300  (prom < 0.33)
   *   Mid:  font_size=15, font_weight=400  (0.33 ≤ prom < 0.66)
   *   High: font_size=18, font_weight=700  (prom ≥ 0.66)
   *
   * Output (Dynamik-style, 3 clearly distinct visual steps):
   *   Low:  14px, weight 300  — small, light
   *   Mid:  22px, weight 500  — medium, normal
   *   High: 30px, weight 800  — large, bold
   */
  _mapProminenceLevel(srcSize, srcWeight) {
    // Normal condition: everything is 18/400 → render uniformly
    if (srcSize === 18 && srcWeight === 400) {
      return [20, 400];
    }
    // 3-level mapping based on source font_size tier
    if (srcSize <= 12) return [14, 300];   // Low prominence
    if (srcSize <= 15) return [22, 500];   // Mid prominence
    return [30, 800];                      // High prominence
  }

  // ═════════════════════════════════════════════════════
  // Quiz
  // ═════════════════════════════════════════════════════

  async _showQuiz(clipId) {
    this._showTrialSub('trialQuiz');
    const container = document.getElementById('quizContainer');
    container.innerHTML = '';

    let questions = [];
    try {
      const res = await fetch(`../subtitle_study/demo_data/${clipId}/questions.json`);
      if (res.ok) {
        const qData = await res.json();
        questions = this._selectQuizQuestions(qData.comprehension || []);
      }
    } catch (e) {
      console.warn(`[Experiment] No questions.json for ${clipId}`);
    }

    if (questions.length === 0) {
      // Placeholder
      container.innerHTML = '<p style="color:var(--tm);font-size:.8rem">Quiz questions not yet available for this clip.</p>';
    } else {
      questions.forEach((q, qi) => {
        const div = document.createElement('div');
        div.className = 'quiz-question';
        const shuffledOpts = this._shuffleOptions(q.options, q.correct);
        div.innerHTML = `
          <div class="quiz-question__text">Q${qi + 1}. ${q.question}</div>
          ${shuffledOpts.map((opt, oi) => `
            <div class="quiz-option">
              <input type="radio" name="quiz_${qi}" id="quiz_${qi}_${oi}" value="${oi}" data-correct="${opt.isCorrect ? 1 : 0}">
              <label for="quiz_${qi}_${oi}">${opt.text}</label>
            </div>
          `).join('')}
        `;
        container.appendChild(div);
      });
    }
  }

  _selectQuizQuestions(pool) {
    const content = pool.filter(q => !q.is_dummy);
    const dummy = pool.filter(q => q.is_dummy);
    this._shuffle(content);
    this._shuffle(dummy);
    // 2 content + 1 dummy = 3 questions
    const selected = [...content.slice(0, 2), ...dummy.slice(0, 1)];
    this._shuffle(selected);
    return selected;
  }

  _shuffleOptions(options, correctIdx) {
    const opts = options.map((text, i) => ({ text, isCorrect: i === correctIdx }));
    this._shuffle(opts);
    return opts;
  }

  _onSubmitQuiz() {
    const answers = [];
    document.querySelectorAll('.quiz-question').forEach((q, qi) => {
      const selected = q.querySelector(`input[name="quiz_${qi}"]:checked`);
      answers.push({
        question_index: qi,
        selected: selected ? parseInt(selected.value) : null,
        correct: selected ? parseInt(selected.dataset.correct) === 1 : false
      });
    });
    this._currentTrialData().quiz = answers;
    this._showIntentTask();
  }

  // ═════════════════════════════════════════════════════
  // Speaker Intent Task
  // ═════════════════════════════════════════════════════

  async _showIntentTask() {
    this._showTrialSub('trialIntent');
    const container = document.getElementById('intentContainer');
    container.innerHTML = '';

    const trial = this.trialOrder[this.currentTrialIdx];
    let intentData = null;
    try {
      const res = await fetch(`../subtitle_study/demo_data/${trial.clip}/questions.json`);
      if (res.ok) {
        const qData = await res.json();
        intentData = qData.speaker_intent;
      }
    } catch (e) {}

    if (!intentData) {
      container.innerHTML = '<p style="color:var(--tm);font-size:.8rem">Speaker intent tasks not yet available.</p>';
      return;
    }

    // Emphasis identification
    if (intentData.emphasis_identification) {
      const ei = intentData.emphasis_identification;
      const block = document.createElement('div');
      block.className = 'intent-block';
      const shuffledOpts = this._shuffleOptions(ei.options, ei.correct);
      block.innerHTML = `
        <div class="intent-block__label">Emphasis Identification</div>
        <div class="intent-sentence">"${ei.sentence}"</div>
        <div class="intent-block__question">${ei.question}</div>
        ${shuffledOpts.map((opt, oi) => `
          <div class="quiz-option">
            <input type="radio" name="intent_emphasis" id="intent_e_${oi}" value="${oi}" data-correct="${opt.isCorrect ? 1 : 0}">
            <label for="intent_e_${oi}">${opt.text}</label>
          </div>
        `).join('')}
      `;
      container.appendChild(block);
    }

    // Attitude estimation
    if (intentData.attitude_estimation) {
      const ae = intentData.attitude_estimation;
      const block = document.createElement('div');
      block.className = 'intent-block';
      const shuffledOpts = this._shuffleOptions(ae.options, ae.correct);
      block.innerHTML = `
        <div class="intent-block__label">Speaker Attitude</div>
        <div class="intent-block__question">${ae.question}</div>
        ${shuffledOpts.map((opt, oi) => `
          <div class="quiz-option">
            <input type="radio" name="intent_attitude" id="intent_a_${oi}" value="${oi}" data-correct="${opt.isCorrect ? 1 : 0}">
            <label for="intent_a_${oi}">${opt.text}</label>
          </div>
        `).join('')}
      `;
      container.appendChild(block);
    }

    // Prosodic structure
    if (intentData.prosodic_structure) {
      const ps = intentData.prosodic_structure;
      const block = document.createElement('div');
      block.className = 'intent-block';
      const shuffledOpts = this._shuffleOptions(ps.options, ps.correct);
      block.innerHTML = `
        <div class="intent-block__label">Prosodic Structure</div>
        <div class="intent-block__question">${ps.question}</div>
        ${shuffledOpts.map((opt, oi) => `
          <div class="quiz-option">
            <input type="radio" name="intent_prosody" id="intent_p_${oi}" value="${oi}" data-correct="${opt.isCorrect ? 1 : 0}">
            <label for="intent_p_${oi}">${opt.text}</label>
          </div>
        `).join('')}
      `;
      container.appendChild(block);
    }
  }

  _onSubmitIntent() {
    const answers = {};
    ['emphasis', 'attitude', 'prosody'].forEach(type => {
      const el = document.querySelector(`input[name="intent_${type}"]:checked`);
      answers[type] = {
        selected: el ? parseInt(el.value) : null,
        correct: el ? parseInt(el.dataset.correct) === 1 : false
      };
    });
    this._currentTrialData().speaker_intent = answers;
    this._showSubjectiveRating();
  }

  // ═════════════════════════════════════════════════════
  // Subjective Rating
  // ═════════════════════════════════════════════════════

  _showSubjectiveRating() {
    this._showTrialSub('trialSubjective');
    const container = document.getElementById('subjectiveContainer');
    container.innerHTML = '';

    const items = this.config.subjective_items || [];
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'rating-item';
      const [lo, hi] = item.scale;
      const range = hi - lo + 1;
      div.innerHTML = `
        <div class="rating-item__label">${item.label}</div>
        <div class="rating-scale" data-item="${item.id}">
          ${Array.from({ length: range }, (_, i) => {
            const v = lo + i;
            return `<label><input type="radio" name="subj_${item.id}" value="${v}"><span class="r-opt">${v}</span></label>`;
          }).join('')}
        </div>
        <div class="rating-anchors"><span>${item.anchors?.[0] || lo}</span><span>${item.anchors?.[1] || hi}</span></div>
      `;
      container.appendChild(div);
    });

    // Update button text for last trial
    const btn = document.getElementById('btnSubmitSubjective');
    btn.textContent = this.currentTrialIdx < this.trialOrder.length - 1 ? 'Next Clip →' : 'Finish Trials →';
  }

  _onSubmitSubjective() {
    const ratings = {};
    (this.config.subjective_items || []).forEach(item => {
      const el = document.querySelector(`input[name="subj_${item.id}"]:checked`);
      ratings[item.id] = el ? parseInt(el.value) : null;
    });
    this._currentTrialData().subjective = ratings;
    this._currentTrialData().timestamp_end = Date.now();

    // Next trial or post-survey
    this.currentTrialIdx++;
    if (this.currentTrialIdx >= this.trialOrder.length) {
      this._showPhase('phasePostSurvey');
      this._updateProgress(0.85);
    } else {
      this._runCurrentTrial();
    }
  }

  // ═════════════════════════════════════════════════════
  // Trial Data Management
  // ═════════════════════════════════════════════════════

  _currentTrialData() {
    const trial = this.trialOrder[this.currentTrialIdx];
    if (!this.data.trials[this.currentTrialIdx]) {
      this.data.trials[this.currentTrialIdx] = {
        trial_index: this.currentTrialIdx,
        clip_id: trial.clip,
        condition: trial.condition,
        pattern: this.pattern,
        clip_info: this.config.clips[trial.clip],
        timestamp_start: Date.now(),
        quiz: [],
        speaker_intent: {},
        subjective: {}
      };
    }
    return this.data.trials[this.currentTrialIdx];
  }

  // ═════════════════════════════════════════════════════
  // Post-Survey
  // ═════════════════════════════════════════════════════

  _onPostSurvey() {
    const $ = id => document.getElementById(id)?.value || '';
    this.data.postSurvey = {
      noticed_differences: $('postNoticeDiff'),
      differences_text: $('postDiffText'),
      preferred_style: $('postPreferred'),
      used_headphones: $('postHeadphones'),
      technical_issues: $('postTechIssues'),
    };
    this._updateProgress(0.95);
    this._complete();
  }

  // ═════════════════════════════════════════════════════
  // Complete
  // ═════════════════════════════════════════════════════

  _complete() {
    // Generate completion code (simple XOR-based)
    const code = this._generateCompletionCode();
    document.getElementById('completionCode').textContent = code;

    this.data.meta = {
      participant_id: this.participantId,
      pattern: this.pattern,
      trial_order: this.trialOrder.map(t => `${t.clip}(${t.condition})`),
      start_time: new Date(this.startTime).toISOString(),
      end_time: new Date().toISOString(),
      duration_s: ((Date.now() - this.startTime) / 1000).toFixed(1),
      completion_code: code,
      config_version: this.config.version,
    };

    this._updateProgress(1);
    this._showPhase('phaseComplete');
    console.log('[Experiment] Complete. Data:', this.data);
  }

  _generateCompletionCode() {
    // Simple deterministic code from participant ID
    const h = this._fnv1a(this.participantId + '_prosodic_caption');
    return 'PC' + (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  }

  _fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // ═════════════════════════════════════════════════════
  // Data Export
  // ═════════════════════════════════════════════════════

  _downloadData() {
    const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `prosodic_exp_${this.participantId || 'unknown'}_${this.pattern}_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ═════════════════════════════════════════════════════
// Boot
// ═════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  window.experiment = new ExperimentRunner();
  window.experiment.init();
});
