import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openSeatingPlanTab, closeDuplicateLpuTabs } from '../services/tabMessenger';

describe('openSeatingPlanTab & closeDuplicateLpuTabs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a new tab with the seating plan URL when none exists', async () => {
    const tabs: any[] = [
      { id: 101, url: 'https://ums.lpu.in/lpuums/StudentAttendance.aspx', active: true }
    ];

    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue(tabs),
        create: vi.fn().mockImplementation(async (opts) => {
          const newTab = { id: 202, url: opts.url, active: opts.active };
          tabs.push(newTab);
          return newTab;
        }),
        update: vi.fn()
      }
    };

    const tab = await openSeatingPlanTab(true);

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://studentums.lpu.in/dashboard/examination/conduct/seatingplan',
      active: true
    });
    expect(tab?.id).toBe(202);
    // Attendance tab at index 0 must remain completely untouched!
    expect(tabs[0].url).toContain('StudentAttendance.aspx');
  });

  it('focuses an existing seating plan tab instead of creating duplicates', async () => {
    const tabs: any[] = [
      { id: 101, url: 'https://ums.lpu.in/lpuums/StudentAttendance.aspx', active: true },
      { id: 202, url: 'https://studentums.lpu.in/dashboard/examination/conduct/seatingplan', active: false }
    ];

    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue(tabs),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({})
      }
    };

    const tab = await openSeatingPlanTab(true);

    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(202, { active: true });
    expect(tab?.id).toBe(202);
  });

  it('closeDuplicateLpuTabs only removes duplicate seating tabs without touching attendance tabs', async () => {
    const tabs: any[] = [
      { id: 101, url: 'https://ums.lpu.in/lpuums/StudentAttendance.aspx', active: false },
      { id: 102, url: 'https://ums.lpu.in/lpuums/StudentDashboard.aspx', active: false },
      { id: 201, url: 'https://studentums.lpu.in/dashboard/examination/conduct/seatingplan', active: true },
      { id: 202, url: 'https://studentums.lpu.in/dashboard/examination/conduct/seatingplan', active: false }
    ];

    let removedIds: number[] = [];
    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue(tabs),
        remove: vi.fn().mockImplementation(async (ids) => {
          removedIds = ids;
        })
      }
    };

    await closeDuplicateLpuTabs();

    // Only duplicate seating tab 202 should be removed; attendance (101) & dashboard (102) must NEVER be closed!
    expect(removedIds).toEqual([202]);
    expect(removedIds).not.toContain(101);
    expect(removedIds).not.toContain(102);
  });
});
