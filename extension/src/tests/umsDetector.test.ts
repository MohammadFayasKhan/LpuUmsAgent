/*
 * UMS Page State Detector Test Suite.
 *
 * Validates domain and page state classification:
 * - LPU UMS hostname validation (ums.lpu.in and subdomains).
 * - Cloudflare challenge / Turnstile captcha detection.
 * - Login form detection vs authenticated dashboard detection.
 * - Student registration ID extraction for session isolation.
 */

import { describe, it, expect } from 'vitest';
import {
  isLpuUmsHostname,
  detectHumanVerification,
  detectLoginPage,
  detectUmsState,
  extractStudentProfile,
  isAuthenticatedUmsUrl
} from '../content/umsDetector';

describe('umsDetector', () => {
  describe('isLpuUmsHostname', () => {
    it('accurately identifies LPU UMS domains', () => {
      expect(isLpuUmsHostname('ums.lpu.in')).toBe(true);
      expect(isLpuUmsHostname('sub.ums.lpu.in')).toBe(true);
      expect(isLpuUmsHostname('lpu.in')).toBe(true);
      expect(isLpuUmsHostname('www.lpu.in')).toBe(true);
    });

    it('rejects foreign domains', () => {
      expect(isLpuUmsHostname('google.com')).toBe(false);
      expect(isLpuUmsHostname('notlpu.in')).toBe(false);
      expect(isLpuUmsHostname('ums.otheruniversity.in')).toBe(false);
      expect(isLpuUmsHostname('')).toBe(false);
    });
  });

  describe('detectHumanVerification', () => {
    it('detects Cloudflare verification elements', () => {
      const doc = document.implementation.createHTMLDocument('Just a moment...');
      const cfDiv = doc.createElement('div');
      cfDiv.id = 'challenge-running';
      doc.body.appendChild(cfDiv);

      expect(detectHumanVerification(doc)).toBe(true);
    });

    it('detects verification by page title', () => {
      const doc = document.implementation.createHTMLDocument('Just a moment... - Cloudflare');
      expect(detectHumanVerification(doc)).toBe(true);
    });

    it('returns false for clean normal pages', () => {
      const doc = document.implementation.createHTMLDocument('LPU UMS Student Portal');
      expect(detectHumanVerification(doc)).toBe(false);
    });
  });

  describe('detectLoginPage', () => {
    it('identifies login form with username/password inputs', () => {
      const doc = document.implementation.createHTMLDocument('Login');
      doc.body.innerHTML = `
        <form>
          <input type="text" id="txtUName" />
          <input type="password" id="txtPassword" />
          <button id="btnLogin">Login</button>
        </form>
      `;

      expect(detectLoginPage(doc, 'https://ums.lpu.in/lpuums/Login.aspx')).toBe(true);
    });

    it('returns false when no password input or on authenticated dashboard', () => {
      const doc = document.implementation.createHTMLDocument('Dashboard');
      doc.body.innerHTML = `<div><h1>Welcome to Student Dashboard</h1></div>`;
      expect(detectLoginPage(doc, 'https://ums.lpu.in/lpuums/StudentDashboard.aspx')).toBe(false);
    });

    it('identifies the real UMS login page URL (loginnew.aspx)', () => {
      const doc = document.implementation.createHTMLDocument('Login');
      doc.body.innerHTML = `<input type="password" id="txtPassword" />`;
      expect(detectLoginPage(doc, 'https://ums.lpu.in/lpuums/loginnew.aspx')).toBe(true);
    });

    it('never classifies an authenticated UMS page as login even with a stray password input', () => {
      const doc = document.implementation.createHTMLDocument('Dashboard');
      // ASP.NET pages sometimes carry hidden inputs; the URL must win.
      doc.body.innerHTML = `<div><input type="password" id="txtPassword" /><button id="btnLogin">x</button></div>`;
      expect(detectLoginPage(doc, 'https://ums.lpu.in/lpuums/StudentDashboard.aspx')).toBe(false);
      expect(
        detectLoginPage(doc, 'https://ums.lpu.in/lpuums/Reports/frmStudentAttendance.aspx')
      ).toBe(false);
    });
  });

  describe('isAuthenticatedUmsUrl', () => {
    it('recognizes authenticated UMS sections', () => {
      expect(isAuthenticatedUmsUrl('https://ums.lpu.in/lpuums/StudentDashboard.aspx')).toBe(true);
      expect(isAuthenticatedUmsUrl('https://ums.lpu.in/lpuums/Reports/frmStudentAttendance.aspx')).toBe(true);
      expect(
        isAuthenticatedUmsUrl('https://studentums.lpu.in/dashboard/examination/conduct/seatingplan')
      ).toBe(true);
      expect(isAuthenticatedUmsUrl('https://ums.lpu.in/lpuums/Reports/frmStudentTimeTable.aspx')).toBe(true);
    });

    it('rejects login pages and foreign URLs', () => {
      expect(isAuthenticatedUmsUrl('https://ums.lpu.in/lpuums/loginnew.aspx')).toBe(false);
      expect(isAuthenticatedUmsUrl('https://ums.lpu.in/')).toBe(false);
      expect(isAuthenticatedUmsUrl('https://google.com/StudentDashboard.aspx')).toBe(false);
      expect(isAuthenticatedUmsUrl('')).toBe(false);
    });
  });

  describe('extractStudentProfile', () => {
    it('extracts student name and registration number from DOM elements', () => {
      const doc = document.implementation.createHTMLDocument('Dashboard');
      doc.body.innerHTML = `
        <div id="header">
          <span id="lblStudentName">Welcome, Jane Doe</span>
          <span id="lblRegistrationNo">12104928</span>
        </div>
      `;

      const profile = extractStudentProfile(doc);
      expect(profile.studentName).toBe('Jane Doe');
      expect(profile.registrationNumber).toBe('12104928');
    });
  });

  describe('detectUmsState', () => {
    it('returns NOT_CONNECTED when not on LPU domain', () => {
      const doc = document.implementation.createHTMLDocument('Google');
      const location = { hostname: 'google.com', href: 'https://google.com', pathname: '/' } as Location;

      const result = detectUmsState(doc, location);
      expect(result.isUmsDomain).toBe(false);
      expect(result.status).toBe('NOT_CONNECTED');
    });

    it('returns UMS_DETECTED on dashboard page', () => {
      const doc = document.implementation.createHTMLDocument('Dashboard');
      doc.body.innerHTML = `<span id="lblStudentName">John</span>`;
      const location = {
        hostname: 'ums.lpu.in',
        href: 'https://ums.lpu.in/lpuums/StudentDashboard.aspx',
        pathname: '/lpuums/StudentDashboard.aspx'
      } as Location;

      const result = detectUmsState(doc, location);
      expect(result.isUmsDomain).toBe(true);
      expect(result.status).toBe('UMS_DETECTED');
      expect(result.pageType).toBe('dashboard');
    });
  });
});
