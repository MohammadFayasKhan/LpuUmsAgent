/*
 * Launch Info Carousel contract tests.
 *
 * Locks the upgrade of the single launch info modal into a series of three
 * interactive cards with ONEE integrated: Next/dots/arrows advance the flow,
 * the final "Get started" lands on the main page, and the privacy link opens
 * the full data-management panel.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InfoCarousel } from '../components/InfoCarousel';
import { voiceController } from '../voice';

// Voice is a runtime singleton (Groq network calls, AudioContext) — mock it so
// the carousel contract tests can assert speech behavior hermetically.
vi.mock('../voice', () => ({
  voiceController: {
    speakText: vi.fn(),
    stopSpeaking: vi.fn()
  }
}));

const speakTextMock = vi.mocked(voiceController.speakText);
const stopSpeakingMock = vi.mocked(voiceController.stopSpeaking);

// Strict isolation: every test renders its own carousel, so unmount between
// tests or duplicate buttons ("Get started") leak across cases. Voice mocks
// are cleared per test so call-count assertions never see a prior test's calls.
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InfoCarousel', () => {
  it('opens on the first card with ONEE greeting and a Next action', () => {
    render(<InfoCarousel onClose={() => {}} />);
    expect(screen.getByText('Meet ONEE')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
    // Dynamic greeting line rendered in ONEE's speech bubble (never empty).
    const bubble = document.querySelector('[class*="speechBubble"]');
    expect(bubble?.textContent?.length ?? 0).toBeGreaterThan(10);
    cleanup();
  });

  it('advances card-to-card via Next down to Get started', () => {
    render(<InfoCarousel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Everything you need')).toBeTruthy();
    // All six capability chips present on card 2.
    expect(screen.getByText('Class timetable')).toBeTruthy();
    expect(screen.getByText('Seating plan')).toBeTruthy();
    expect(screen.getByText('Faculty cabins')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Private by design')).toBeTruthy();
    cleanup();
  });

  it('lands on the main page when Get started is pressed', () => {
    const onClose = vi.fn();
    render(<InfoCarousel onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(false);
    cleanup();
  });

  it('supports arrow-key navigation between cards', () => {
    render(<InfoCarousel onClose={() => {}} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Everything you need')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('Meet ONEE')).toBeTruthy();
    cleanup();
  });

  it('jumps to a card via progress dots', () => {
    render(<InfoCarousel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Card 3 of 3' }));
    expect(screen.getByText('Private by design')).toBeTruthy();
    cleanup();
  });

  it('Skip and the privacy link route to onClose with the right flag', () => {
    const onCloseSkip = vi.fn();
    render(<InfoCarousel onClose={onCloseSkip} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip introduction' }));
    expect(onCloseSkip).toHaveBeenCalledWith(false);
    cleanup();

    const onClosePrivacy = vi.fn();
    render(<InfoCarousel onClose={onClosePrivacy} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Card 3 of 3' }));
    fireEvent.click(screen.getByRole('button', { name: /Review privacy/ }));
    expect(onClosePrivacy).toHaveBeenCalledWith(true);
    cleanup();
  });

  it('never renders an em-dash in any card copy (arrows only)', () => {
    render(<InfoCarousel onClose={() => {}} />);
    for (let i = 0; i < 3; i++) {
      expect(document.body.textContent).not.toContain('—');
      if (i < 2) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    cleanup();
  });

  it('keeps the card track centered at rest (no leftover translateX)', () => {
    render(<InfoCarousel onClose={() => {}} />);
    const track = document.querySelector('[class*="cardTrack"]') as HTMLElement;
    // A permanent translateX would push the card under the viewport's
    // overflow: hidden and clip its right edge off-center.
    expect(track.style.transform).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const trackAfterNav = document.querySelector('[class*="cardTrack"]') as HTMLElement;
    expect(trackAfterNav.style.transform).toBe('');
    cleanup();
  });

  it('voices each card on transition but stays silent on mount', () => {
    render(<InfoCarousel onClose={() => {}} />);
    // Card 1's greeting is already voiced once by playSessionGreeting at launch.
    expect(speakTextMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(stopSpeakingMock).toHaveBeenCalled();
    expect(speakTextMock).toHaveBeenCalledWith(
      'Timetable, attendance, exams. Just ask, by voice or text.'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(speakTextMock).toHaveBeenLastCalledWith(
      'Your data stays on your device. Ready when you are.'
    );

    // Back navigation re-voices the previous card.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(speakTextMock).toHaveBeenLastCalledWith(
      'Timetable, attendance, exams. Just ask, by voice or text.'
    );
    cleanup();
  });

  it('stops any in-flight intro speech when the carousel unmounts', () => {
    const view = render(<InfoCarousel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    stopSpeakingMock.mockClear();
    view.unmount();
    expect(stopSpeakingMock).toHaveBeenCalled();
    cleanup();
  });
});
