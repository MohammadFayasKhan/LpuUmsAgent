import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initAiCursorOverlay,
  showCursor,
  hideCursor,
  highlightElement
} from '../content/aiCursorOverlay';
import { broadcastTabMessage } from '../services/tabMessenger';

describe('aiCursorOverlay & broadcastTabMessage', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes cursor overlay and mounts to document.body', () => {
    initAiCursorOverlay();
    const root = document.getElementById('onee-ai-cursor-root');
    expect(root).not.toBeNull();
    expect(root?.querySelector('#onee-ai-pointer')).not.toBeNull();
    expect(root?.querySelector('#onee-ai-status-pill')).not.toBeNull();
  });

  it('re-binds existing DOM elements if #onee-ai-cursor-root pre-exists', () => {
    // Simulate pre-existing DOM from prior injection
    const preExisting = document.createElement('div');
    preExisting.id = 'onee-ai-cursor-root';
    preExisting.innerHTML = `
      <div id="onee-ai-pointer" style="opacity: 1;"></div>
      <div id="onee-ai-status-pill"></div>
      <div id="onee-ai-highlight-box"></div>
      <div id="onee-ai-target-badge"></div>
    `;
    preExisting.style.opacity = '1';
    preExisting.style.display = 'block';
    document.body.appendChild(preExisting);

    // Call init and then hideCursor
    initAiCursorOverlay();
    hideCursor();

    expect(preExisting.style.opacity).toBe('0');
    const ptr = preExisting.querySelector('#onee-ai-pointer') as HTMLDivElement;
    expect(ptr.style.opacity).toBe('0');

    // Advance timer past the 240ms transition
    vi.advanceTimersByTime(250);
    expect(preExisting.style.display).toBe('none');
  });

  it('shows and hides cursor gracefully', () => {
    showCursor(200, 300, 'Checking exams');
    const root = document.getElementById('onee-ai-cursor-root');
    expect(root).not.toBeNull();
    expect(root?.style.display).toBe('block');

    hideCursor();
    expect(root?.style.opacity).toBe('0');

    vi.advanceTimersByTime(250);
    expect(root?.style.display).toBe('none');
  });

  it('broadcastTabMessage queries all tabs and sends message to all LPU tabs', async () => {
    const mockSendMessage = vi.fn((_tabId, _msg, cb) => cb && cb({}));
    const mockQuery = vi.fn().mockResolvedValue([
      { id: 101, url: 'https://ums.lpu.in/lpuums/StudentDashboard.aspx' },
      { id: 102, url: 'https://studentums.lpu.in/dashboard/examination/conduct/seatingplan' },
      { id: 103, url: 'https://google.com' }
    ]);

    (global as any).chrome = {
      tabs: {
        query: mockQuery,
        sendMessage: mockSendMessage
      },
      runtime: {}
    };

    await broadcastTabMessage({ type: 'ONEE_HIDE_CURSOR' });

    expect(mockQuery).toHaveBeenCalledWith({});
    // Should send to tab 101 and 102 (both LPU), but NOT tab 103 (google.com)
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenCalledWith(101, { type: 'ONEE_HIDE_CURSOR' }, expect.any(Function));
    expect(mockSendMessage).toHaveBeenCalledWith(102, { type: 'ONEE_HIDE_CURSOR' }, expect.any(Function));
  });

  it('highlights attendance element with tight bounding box without left gap', () => {
    const container = document.createElement('div');
    container.className = 'col-xs-6 text-right';
    container.innerHTML = `
      <span class="lbl-attendance">ATTENDANCE : 91%</span>
      <a href="#"><i class="fa fa-info-circle"></i></a>
    `;
    container.getBoundingClientRect = () => ({
      top: 200,
      bottom: 232,
      left: 400,
      right: 660,
      width: 260,
      height: 32,
      x: 400,
      y: 200,
      toJSON: () => {}
    });

    const span = container.querySelector('span') as HTMLElement;
    span.getBoundingClientRect = () => ({
      top: 200,
      bottom: 232,
      left: 540,
      right: 635,
      width: 95,
      height: 32,
      x: 540,
      y: 200,
      toJSON: () => {}
    });

    const icon = container.querySelector('i') as HTMLElement;
    icon.getBoundingClientRect = () => ({
      top: 200,
      bottom: 232,
      left: 640,
      right: 660,
      width: 20,
      height: 32,
      x: 640,
      y: 200,
      toJSON: () => {}
    });

    document.body.appendChild(container);

    highlightElement(container, 'ATTENDANCE : 91% ⓘ', 'discovered');

    const highlightBox = document.getElementById('onee-ai-highlight-box');
    expect(highlightBox).not.toBeNull();
    // Padding of 4px on each side: left is 540 - 4 = 536, width is 120 + 8 = 128
    expect(highlightBox?.style.transform).toBe('translate3d(536px, 196px, 0)');
    expect(highlightBox?.style.width).toBe('128px');
  });
});

