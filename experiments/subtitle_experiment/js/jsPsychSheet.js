/**
 * jsPsychSheet.js — Google Sheets data persistence via Google Apps Script
 *
 * Usage:
 *   1. Create a Google Sheet
 *   2. Go to Extensions → Apps Script
 *   3. Paste the GAS code from gas_server.js into the Apps Script editor
 *   4. Deploy as Web App (Anyone can access)
 *   5. Copy the Web App URL and set it below
 *
 * Integration with jsPsych:
 *   import { pushToSheet } from './jsPsychSheet.js';
 *   jsPsych.init({ on_finish: () => pushToSheet(jsPsych.data.get().json()) });
 */

const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzfvhflce5EVmByO5xsEBMcQjys06CyTn8APKQstwjjdYUe_Dis6ZX9AQNeqyzbZlYw/exec';  // ← Set your Google Apps Script Web App URL here

/**
 * Push experiment data to Google Sheets via GAS Web App
 * @param {string} jsonData — JSON string from jsPsych.data.get().json()
 * @param {string} sheetName — Target sheet name (default: 'responses')
 * @returns {Promise<boolean>} — Success status
 */
export async function pushToSheet(jsonData, sheetName = 'responses') {
  if (!GAS_WEB_APP_URL) {
    console.warn('[jsPsychSheet] No GAS Web App URL configured. Data not sent.');
    return false;
  }

  try {
    const response = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      mode: 'no-cors',    // GAS requires no-cors from cross-origin pages
      headers: { 'Content-Type': 'text/plain' },  // must be simple header for no-cors
      redirect: 'follow',
      body: JSON.stringify({
        sheetName: sheetName,
        data: jsonData,
      }),
    });

    console.log('[jsPsychSheet] Data sent successfully');
    return true;
  } catch (error) {
    console.error('[jsPsychSheet] Failed to send data:', error);
    return false;
  }
}

/**
 * Push a single trial row to Google Sheets
 * @param {Object} trialData — Single trial data object
 * @param {string} sheetName — Target sheet name
 */
export async function pushTrialRow(trialData, sheetName = 'responses') {
  if (!GAS_WEB_APP_URL) return false;

  try {
    await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      redirect: 'follow',
      body: JSON.stringify({
        sheetName: sheetName,
        row: trialData,
      }),
    });
    return true;
  } catch (error) {
    console.error('[jsPsychSheet] Failed to push row:', error);
    return false;
  }
}
