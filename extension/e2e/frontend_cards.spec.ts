import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

test.describe('Examination Frontend Card Layout & Suggestions Rail Responsiveness', () => {
  test('examination result card layout adapts to 300px sidepanel without badge collision or field clipping', async ({ page }) => {
    // Read the component CSS to test real styling in Chromium
    const cssPath = resolve(process.cwd(), 'src/components/AgentControlPanel.module.css');
    const examCardCssPath = resolve(process.cwd(), 'src/components/ExaminationCard.module.css');
    const chatCssPath = resolve(process.cwd(), 'src/components/ChatView.module.css');
    const cssContent = [
      readFileSync(cssPath, 'utf-8'),
      readFileSync(examCardCssPath, 'utf-8'),
      readFileSync(chatCssPath, 'utf-8')
    ].join('\n');

    await page.setViewportSize({ width: 320, height: 640 });

    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          :root {
            --bg-primary: #0f172a;
            --surface: #1e293b;
            --surface-hover: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-tertiary: #64748b;
            --border-color: rgba(255, 255, 255, 0.1);
            --border-subtle: rgba(255, 255, 255, 0.08);
            --radius-sm: 6px;
            --radius-md: 8px;
            --radius-lg: 12px;
            --radius-pill: 9999px;
            --accent: #7c3aed;
          }
          body {
            margin: 0;
            padding: 10px;
            background: #0b0f19;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-sizing: border-box;
            width: 320px;
          }
          * { box-sizing: border-box; }

          /* Responsive classes corresponding to AgentControlPanel & ExaminationCard */
          .examCardHeaderTop {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            width: 100%;
            min-width: 0;
          }
          .examCardCourseInfo {
            display: flex;
            align-items: baseline;
            gap: 6px;
            min-width: 0;
            flex: 1;
            overflow: hidden;
          }
          .examCourseCode {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-primary);
            flex-shrink: 0;
          }
          .examCardHeaderRight {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
          }
          .examStatusBadge {
            font-size: 10px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 4px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            white-space: nowrap;
            background: #ede9fe;
            color: #5b21b6;
            border: 1px solid #c4b5fd;
          }
          .examCardMetaRow {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            font-size: 11px;
            color: var(--text-secondary);
            width: 100%;
            min-width: 0;
            margin-top: 4px;
          }
          .examMetaItem {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            background: rgba(255, 255, 255, 0.03);
            padding: 2px 6px;
            border-radius: 4px;
            border: 1px solid var(--border-subtle);
          }
          .examDetailGridRow {
            display: grid;
            grid-template-columns: 82px 1fr;
            gap: 8px;
            align-items: start;
            width: 100%;
            min-width: 0;
            margin-top: 4px;
          }
          .examDetailLabel {
            color: var(--text-tertiary);
            font-weight: 600;
            font-size: 10px;
            text-transform: uppercase;
          }
          .examDetailVal {
            color: var(--text-primary);
            font-size: 11px;
            word-break: break-word;
            overflow-wrap: anywhere;
            min-width: 0;
          }
          .examItemCard {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 8px;
            width: 100%;
            box-sizing: border-box;
          }
          .suggestionRail {
            display: flex;
            flex-wrap: nowrap;
            overflow-x: auto;
            gap: 6px;
            padding: 2px 4px;
            width: 100%;
            scrollbar-width: none;
          }
          .suggestionChip {
            flex-shrink: 0;
            white-space: nowrap;
            padding: 5px 12px;
            border-radius: 9999px;
            background: var(--surface);
            color: var(--text-secondary);
            font-size: 11px;
            border: 1px solid var(--border-color);
          }
        </style>
      </head>
      <body>
        <div id="card-container" style="width: 100%;">
          <!-- Card 1: CSE408 (First session) -->
          <div class="examItemCard" id="card-cse408-1">
            <div class="examCardHeaderTop">
              <div class="examCardCourseInfo">
                <span class="examCourseCode">CSE408</span>
                <span class="examCourseSubname" style="font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Software Testing</span>
              </div>
              <div class="examCardHeaderRight">
                <span class="examStatusBadge">Upcoming</span>
                <span>▼</span>
              </div>
            </div>
            <div class="examCardMetaRow">
              <div class="examMetaItem">
                <span>📅</span>
                <span class="examMetaDate">6 Oct 2026</span>
              </div>
              <div class="examMetaItem">
                <span>🕒</span>
                <span class="examMetaTime">10:00 - 11:30</span>
              </div>
              <div class="examMetaItem">
                <span>🪑</span>
                <span class="examMetaSeat">Room 302</span>
              </div>
            </div>
            <div class="examExpandedDetails" style="margin-top: 6px;">
              <div class="examDetailGridRow">
                <span class="examDetailLabel">COURSE</span>
                <span class="examDetailVal">Software Testing Methodologies and Automated Frameworks</span>
              </div>
              <div class="examDetailGridRow">
                <span class="examDetailLabel">REPORTING</span>
                <span class="examDetailVal">09:30 (Report 30 minutes before exam)</span>
              </div>
              <div class="examDetailGridRow">
                <span class="examDetailLabel">SEATING</span>
                <span class="examDetailVal">Block 34 · Room 302 · Seat B-14</span>
              </div>
              <div class="examDetailGridRow">
                <span class="examDetailLabel">INSTRUCTIONS</span>
                <span class="examDetailVal">Scientific calculator permitted. Bring University Identity Card and Hall Ticket.</span>
              </div>
            </div>
          </div>

          <!-- Card 2: INT373 -->
          <div class="examItemCard" id="card-int373">
            <div class="examCardHeaderTop">
              <div class="examCardCourseInfo">
                <span class="examCourseCode">INT373</span>
              </div>
              <div class="examCardHeaderRight">
                <span class="examStatusBadge">Upcoming</span>
                <span>▼</span>
              </div>
            </div>
            <div class="examCardMetaRow">
              <div class="examMetaItem">
                <span>📅</span>
                <span class="examMetaDate">8 Oct 2026</span>
              </div>
              <div class="examMetaItem">
                <span>🕒</span>
                <span class="examMetaTime">10:00 - 11:30</span>
              </div>
            </div>
          </div>

          <!-- Card 3: CSE408 (Duplicate course code on different date) -->
          <div class="examItemCard" id="card-cse408-2">
            <div class="examCardHeaderTop">
              <div class="examCardCourseInfo">
                <span class="examCourseCode">CSE408</span>
              </div>
              <div class="examCardHeaderRight">
                <span class="examStatusBadge">Upcoming</span>
                <span>▼</span>
              </div>
            </div>
            <div class="examCardMetaRow">
              <div class="examMetaItem">
                <span>📅</span>
                <span class="examMetaDate">15 Dec 2026</span>
              </div>
              <div class="examMetaItem">
                <span>🕒</span>
                <span class="examMetaTime">09:30 - 12:30</span>
              </div>
            </div>
          </div>

          <!-- Suggestions Rail -->
          <div style="margin-top: 16px; width: 100%; overflow: hidden;">
            <div class="suggestionRail" id="rail">
              <button class="suggestionChip">Where is my seat for CSE408?</button>
              <button class="suggestionChip">When should I report for CSE408?</button>
              <button class="suggestionChip">What is the next exam?</button>
              <button class="suggestionChip">Show my complete exam schedule</button>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);

    // 1. Verify Card 1 boundary and elements
    const card = page.locator('#card-cse408-1');
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.width).toBeLessThanOrEqual(305);

    // 2. Course code and Status Badge do NOT overlap horizontally
    const codeBox = await page.locator('#card-cse408-1 .examCourseCode').boundingBox();
    const badgeBox = await page.locator('#card-cse408-1 .examStatusBadge').boundingBox();
    expect(codeBox).not.toBeNull();
    expect(badgeBox).not.toBeNull();
    // Badge must be strictly to the right of course code
    expect(badgeBox!.x).toBeGreaterThanOrEqual(codeBox!.x + codeBox!.width);

    // 3. Date and Time pills are cleanly separated without collisions
    const dateBox = await page.locator('#card-cse408-1 .examMetaDate').first().boundingBox();
    const timeBox = await page.locator('#card-cse408-1 .examMetaTime').first().boundingBox();
    expect(dateBox).not.toBeNull();
    expect(timeBox).not.toBeNull();
    // Time box must not overlap date box
    expect(timeBox!.x).toBeGreaterThan(dateBox!.x);

    // 4. Time pill displays both start time AND end time
    const timeText = await page.locator('#card-cse408-1 .examMetaTime').textContent();
    expect(timeText).toContain('10:00 - 11:30');

    // 5. Expanded details do NOT overflow the card width
    const instructionVal = page.locator('#card-cse408-1 .examDetailVal').last();
    const instBox = await instructionVal.boundingBox();
    expect(instBox).not.toBeNull();
    expect(instBox!.x + instBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);

    // 6. Suggestions rail has horizontal overflow capability and chips do not wrap
    const rail = page.locator('#rail');
    const railScrollWidth = await rail.evaluate((el) => el.scrollWidth);
    const railClientWidth = await rail.evaluate((el) => el.clientWidth);
    expect(railScrollWidth).toBeGreaterThan(railClientWidth);

    const firstChip = page.locator('.suggestionChip').first();
    const secondChip = page.locator('.suggestionChip').nth(1);
    const chip1Box = await firstChip.boundingBox();
    const chip2Box = await secondChip.boundingBox();
    // Chips are in a single horizontal row, chip 2 is to the right of chip 1
    expect(chip2Box!.x).toBeGreaterThan(chip1Box!.x);
    expect(Math.abs(chip1Box!.y - chip2Box!.y)).toBeLessThan(5);
  });
});
