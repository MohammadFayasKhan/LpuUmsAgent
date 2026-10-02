import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  findDedicatedSamplePaperBox,
  findSamplePaperButtonForCourse,
  executeOpenSamplePaper
} from '../content/samplePaperAgent';

describe('samplePaperAgent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('findDedicatedSamplePaperBox', () => {
    it('isolates the dedicated purple sample paper box and rejects outer card body/column containers', () => {
      const card = document.createElement('div');
      card.className = 'exam-card-container';
      card.innerHTML = `
        <div class="card-header">
          <h3>CSE408 -</h3>
          <span class="badge">Upcoming</span>
        </div>
        <div class="card-body">
          <div class="meta-row">
            <span>15 Dec 2026</span>
            <span>09:30-12:30 [Report 30 minutes before the start of exam]</span>
          </div>
          <div class="status-row">
            <span>Awaited</span>
            <span>Theory End Term - All MCQ Objective Type</span>
          </div>
          <div class="desc-row">
            <span>60 Multiple Choice Questions of 1 Mark each</span>
          </div>
          <div class="col-md-4 col-sm-12 action-col">
            <div class="sample-paper-purple-box" style="width: 240px; height: 60px;">
              <span class="icon">📄</span>
              <div class="content">
                <strong>Sample Question Paper</strong>
                <p>Click to download the sample question paper</p>
              </div>
            </div>
          </div>
        </div>
      `;

      // Mock getBoundingClientRect
      const outerCol = card.querySelector('.action-col') as HTMLElement;
      const purpleBox = card.querySelector('.sample-paper-purple-box') as HTMLElement;

      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
        width: 800,
        height: 200,
        top: 100,
        bottom: 300,
        left: 50,
        right: 850,
        x: 50,
        y: 100,
        toJSON: () => {}
      });

      vi.spyOn(outerCol, 'getBoundingClientRect').mockReturnValue({
        width: 400,
        height: 160,
        top: 120,
        bottom: 280,
        left: 450,
        right: 850,
        x: 450,
        y: 120,
        toJSON: () => {}
      });

      vi.spyOn(purpleBox, 'getBoundingClientRect').mockReturnValue({
        width: 240,
        height: 60,
        top: 150,
        bottom: 210,
        left: 500,
        right: 740,
        x: 500,
        y: 150,
        toJSON: () => {}
      });

      const dedicated = findDedicatedSamplePaperBox(card);
      expect(dedicated).not.toBeNull();
      // Must be the purple box, NOT the outer card or outer col
      expect(dedicated).toBe(purpleBox);
      expect(dedicated?.classList.contains('sample-paper-purple-box')).toBe(true);
      expect(dedicated).not.toBe(card);
      expect(dedicated).not.toBe(outerCol);
    });

    it('returns an explicit button if button with sample paper text is present', () => {
      const card = document.createElement('div');
      card.innerHTML = `
        <div class="exam-title">INT373</div>
        <button class="btn btn-primary download-sample-btn">
          Sample Question Paper
        </button>
      `;
      const btn = card.querySelector('button') as HTMLElement;
      const dedicated = findDedicatedSamplePaperBox(card);
      expect(dedicated).toBe(btn);
    });

    it('returns an explicit anchor link if a link with sample paper text is present', () => {
      const card = document.createElement('div');
      card.innerHTML = `
        <div class="exam-title">CSE471</div>
        <a href="/sample_papers/cse471.pdf" class="sample-link">
          Sample Paper
        </a>
      `;
      const anchor = card.querySelector('a') as HTMLElement;
      const dedicated = findDedicatedSamplePaperBox(card);
      expect(dedicated).toBe(anchor);
    });

    it('returns null if card has no sample question paper text or attributes', () => {
      const card = document.createElement('div');
      card.innerHTML = `
        <div class="exam-title">INT373</div>
        <div>Theory Mid Term - All Subjective</div>
        <div>No sample papers uploaded</div>
      `;
      const dedicated = findDedicatedSamplePaperBox(card);
      expect(dedicated).toBeNull();
    });
  });

  describe('findSamplePaperButtonForCourse', () => {
    it('locates the correct card and dedicated button for a course', () => {
      const doc = document;
      doc.body.innerHTML = `
        <div class="card mb-3 exam-card">
          <div class="card-header">INT373 -</div>
          <div class="card-body">Theory Mid Term - All Subjective</div>
        </div>
        <div class="card mb-3 exam-card">
          <div class="card-header">CSE408 -</div>
          <div class="card-body">
            <div>Theory End Term</div>
            <div class="sample-paper-btn" style="width: 200px; height: 50px;">
              <span>Sample Question Paper</span>
            </div>
          </div>
        </div>
        <div class="card mb-3 exam-card">
          <div class="card-header">CSE471 -</div>
          <div class="card-body">Theory End Term</div>
        </div>
      `;

      const cse408Card = doc.querySelectorAll('.exam-card')[1] as HTMLElement;
      const sampleBtn = cse408Card.querySelector('.sample-paper-btn') as HTMLElement;
      vi.spyOn(sampleBtn, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 50,
        top: 200,
        bottom: 250,
        left: 300,
        right: 500,
        x: 300,
        y: 200,
        toJSON: () => {}
      });

      const result = findSamplePaperButtonForCourse('CSE408', doc);
      expect(result.cardElement).toBe(cse408Card);
      expect(result.buttonElement).toBe(sampleBtn);
    });
  });

  describe('executeOpenSamplePaper', () => {
    it('scrolls the dedicated box into view, animates cursor, and dispatches click', async () => {
      const button = document.createElement('div');
      button.className = 'sample-paper-btn';
      button.textContent = 'Sample Question Paper';
      document.body.appendChild(button);

      const scrollSpy = vi.fn();
      button.scrollIntoView = scrollSpy;

      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 50,
        top: 200,
        bottom: 250,
        left: 300,
        right: 500,
        x: 300,
        y: 200,
        toJSON: () => {}
      });

      const clickSpy = vi.fn();
      button.addEventListener('click', clickSpy);

      const res = await executeOpenSamplePaper('CSE408', button);

      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
        inline: 'center'
      });
      expect(clickSpy).toHaveBeenCalled();
      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);
      expect(res.courseCode).toBe('CSE408');
      expect(res.actionTaken).toBe('downloaded');
      expect(res.fileName).toBe('CSE408_Sample_Paper.pdf');
    });

    it('detects direct PDF href and sets preview_ready', async () => {
      const anchor = document.createElement('a');
      anchor.href = 'https://studentums.lpu.in/papers/cse408_sample.pdf';
      anchor.textContent = 'Sample Question Paper';
      document.body.appendChild(anchor);

      anchor.scrollIntoView = vi.fn();
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
        width: 150,
        height: 40,
        top: 100,
        bottom: 140,
        left: 200,
        right: 350,
        x: 200,
        y: 100,
        toJSON: () => {}
      });

      const res = await executeOpenSamplePaper('CSE408', anchor);
      expect(res.success).toBe(true);
      expect(res.actionTaken).toBe('preview_ready');
      expect(res.paperUrl).toBe('https://studentums.lpu.in/papers/cse408_sample.pdf');
    });

    it('returns error when sample paper button cannot be found', async () => {
      const res = await executeOpenSamplePaper('NONEXISTENT101', document);
      expect(res.success).toBe(false);
      expect(res.error).toContain('not found on page');
      expect(res.verified).toBe(false);
    });
  });
});
