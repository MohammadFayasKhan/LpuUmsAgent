import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatView } from '../components/ChatView';

// Mock dependencies that rely on browser/runtime APIs
vi.mock('../voice', () => ({
  useVoiceAgent: () => ({
    interimTranscript: '',
    isListening: false,
    isSpeaking: false,
    toggleListening: vi.fn()
  }),
  audioController: {
    unlockAudio: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../components/OneeCompanion', () => ({
  OneeCompanion: () => <div data-testid="onee-companion" />
}));

describe('ChatView Followup Suggestions', () => {
  const mockSuggestions = [
    'Where is my seat for INT373?',
    'Show the sample paper for INT373',
    'When should I report for INT373?'
  ];

  beforeEach(() => {
    if (typeof window.PointerEvent === 'undefined') {
      (window as any).PointerEvent = class PointerEvent extends MouseEvent {
        pointerId: number;
        constructor(type: string, params: any = {}) {
          super(type, params);
          this.pointerId = params.pointerId || 0;
        }
      };
    }
    vi.clearAllMocks();
  });

  it('renders all followup suggestion chips with correct attributes', () => {
    const onSendMessage = vi.fn();

    render(
      <ChatView
        messages={[]}
        isTyping={false}
        onSendMessage={onSendMessage}
        suggestions={mockSuggestions}
      />
    );

    // Header label
    expect(screen.getByText('SUGGESTED')).toBeDefined();

    // Verify chips
    const chip1 = screen.getByRole('button', { name: 'Where is my seat for INT373?' });
    const chip2 = screen.getByRole('button', { name: 'Show the sample paper for INT373' });
    const chip3 = screen.getByRole('button', { name: 'When should I report for INT373?' });

    expect(chip1).toBeDefined();
    expect(chip2).toBeDefined();
    expect(chip3).toBeDefined();

    expect(chip1.getAttribute('type')).toBe('button');
    expect(chip1.getAttribute('title')).toBe('Where is my seat for INT373?');
    expect(chip1.hasAttribute('disabled')).toBe(false);
  });

  it('successfully fires onSendMessage when a user clicks a suggestion chip', () => {
    const onSendMessage = vi.fn();

    render(
      <ChatView
        messages={[]}
        isTyping={false}
        onSendMessage={onSendMessage}
        suggestions={mockSuggestions}
      />
    );

    const chip1 = screen.getByRole('button', { name: 'Where is my seat for INT373?' });

    // Normal click gesture without pointer drag
    fireEvent.pointerDown(chip1, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(chip1, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.click(chip1);

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith('Where is my seat for INT373?');

    // Click second chip
    const chip2 = screen.getByRole('button', { name: 'Show the sample paper for INT373' });
    fireEvent.pointerDown(chip2, { button: 0, clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(chip2, { button: 0, clientX: 150, pointerId: 1 });
    fireEvent.click(chip2);

    expect(onSendMessage).toHaveBeenCalledTimes(2);
    expect(onSendMessage).toHaveBeenCalledWith('Show the sample paper for INT373');
  });

  it('disables suggestion chips when isTyping is true', () => {
    const onSendMessage = vi.fn();

    render(
      <ChatView
        messages={[]}
        isTyping={true}
        onSendMessage={onSendMessage}
        suggestions={mockSuggestions}
      />
    );

    const chip1 = screen.getByRole('button', { name: 'Where is my seat for INT373?' });
    expect(chip1.hasAttribute('disabled')).toBe(true);

    fireEvent.click(chip1);
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('does not fire suggestion click during a drag gesture (>8px movement)', () => {
    const onSendMessage = vi.fn();

    render(
      <ChatView
        messages={[]}
        isTyping={false}
        onSendMessage={onSendMessage}
        suggestions={mockSuggestions}
      />
    );

    const rail = screen.getByRole('region', { name: 'Suggested questions' });
    const chip1 = screen.getByRole('button', { name: 'Where is my seat for INT373?' });

    // Simulate drag start at 100 and move to 150 (50px displacement)
    fireEvent.pointerDown(rail, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 150, pointerId: 1 });

    // Browser fires click on release
    fireEvent.click(chip1);

    // Should NOT have triggered suggestion send because it was a drag
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('supports keyboard navigation with ArrowRight and ArrowLeft on rail', () => {
    const onSendMessage = vi.fn();

    render(
      <ChatView
        messages={[]}
        isTyping={false}
        onSendMessage={onSendMessage}
        suggestions={mockSuggestions}
      />
    );

    const rail = screen.getByRole('region', { name: 'Suggested questions' });
    rail.scrollBy = vi.fn();

    fireEvent.keyDown(rail, { key: 'ArrowRight' });
    expect(rail.scrollBy).toHaveBeenCalledWith({ left: 140, behavior: 'smooth' });

    fireEvent.keyDown(rail, { key: 'ArrowLeft' });
    expect(rail.scrollBy).toHaveBeenCalledWith({ left: -140, behavior: 'smooth' });
  });
});
