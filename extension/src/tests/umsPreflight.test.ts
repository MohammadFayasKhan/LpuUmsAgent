/*
 * UMS Preflight & Blocking Notification Test Suite.
 *
 * Validates:
 * - Detecting Campus Drive Notifications popup in various DOM layouts.
 * - Prioritizing "Remind me later" and strictly avoiding "Mark as Read".
 * - Clean pass-through when no blocking popup is present.
 */

import { describe, it, expect } from 'vitest';
import {
  detectCampusDriveModal,
  runUmsPreflight,
  markCampusModalDismissed,
  isCampusModalCoolingDown
} from '../content/umsPreflight';

describe('umsPreflight', () => {
  it('detects Campus Drive popup and targets "Remind me later" button', () => {
    const doc = document.implementation.createHTMLDocument('Student Dashboard');
    const modal = doc.createElement('div');
    modal.className = 'modal show';
    modal.style.display = 'block';

    const header = doc.createElement('h4');
    header.textContent = 'Campus Drive Notifications';
    modal.appendChild(header);

    const sub = doc.createElement('p');
    sub.textContent = 'You are eligible for below drives';
    modal.appendChild(sub);

    const markBtn = doc.createElement('button');
    markBtn.textContent = 'Mark as Read';
    modal.appendChild(markBtn);

    const remindBtn = doc.createElement('button');
    remindBtn.textContent = 'Remind me later';
    modal.appendChild(remindBtn);

    doc.body.appendChild(modal);

    const detection = detectCampusDriveModal(doc);
    expect(detection.isModalOpen).toBe(true);
    expect(detection.isCampusDrive).toBe(true);
    expect(detection.remindButton).not.toBeNull();
    expect(detection.remindButton?.textContent).toBe('Remind me later');
    expect(detection.remindButton).not.toBe(markBtn);
  });

  it('detects popup rendered via custom ASP.NET popup without bootstrap classes', () => {
    const doc = document.implementation.createHTMLDocument('Student Dashboard');
    const wrapper = doc.createElement('div');
    wrapper.id = 'pnlNotification';

    const titleDiv = doc.createElement('div');
    titleDiv.textContent = 'Campus Drive Notifications';
    wrapper.appendChild(titleDiv);

    const remindLink = doc.createElement('a');
    remindLink.href = '#';
    remindLink.textContent = 'Remind me later';
    wrapper.appendChild(remindLink);

    doc.body.appendChild(wrapper);

    const detection = detectCampusDriveModal(doc);
    expect(detection.isModalOpen).toBe(true);
    expect(detection.remindButton).toBe(remindLink);
  });

  it('detects popup with spelling "Remaind Me Later" and ASP.NET input[type="button"]', () => {
    const doc = document.implementation.createHTMLDocument('Student Dashboard');
    const panel = doc.createElement('div');
    panel.setAttribute('style', 'position: fixed; z-index: 10000; top: 100px; left: 100px;');

    const header = doc.createElement('h3');
    header.textContent = 'Campus Drive Notifications';
    panel.appendChild(header);

    const markBtn = doc.createElement('input');
    markBtn.type = 'button';
    markBtn.value = 'Mark as Read';
    panel.appendChild(markBtn);

    const remindInput = doc.createElement('input');
    remindInput.type = 'button';
    remindInput.value = 'Remaind Me Later';
    panel.appendChild(remindInput);

    doc.body.appendChild(panel);

    const detection = detectCampusDriveModal(doc);
    expect(detection.isModalOpen).toBe(true);
    expect(detection.remindButton).toBe(remindInput);
  });

  it('detects button with non-breaking spaces and inner span element', () => {
    const doc = document.implementation.createHTMLDocument('Student Dashboard');
    const modal = doc.createElement('div');
    modal.className = 'modal';

    const h = doc.createElement('div');
    h.textContent = 'Campus Drive Notifications';
    modal.appendChild(h);

    const btn = doc.createElement('button');
    btn.className = 'btn btn-danger';
    const span = doc.createElement('span');
    span.textContent = 'Remind\u00a0me\u00a0later';
    btn.appendChild(span);
    modal.appendChild(btn);

    doc.body.appendChild(modal);

    const detection = detectCampusDriveModal(doc);
    expect(detection.isModalOpen).toBe(true);
    expect(detection.remindButton).toBe(btn);
  });

  it('identifies safe dismissal button using sibling heuristic from "Mark as Read"', () => {
    const doc = document.implementation.createHTMLDocument('Student Dashboard');
    const container = doc.createElement('div');
    container.className = 'modal-content';

    const heading = doc.createElement('h4');
    heading.textContent = 'Campus Drive Notifications';
    container.appendChild(heading);

    const footer = doc.createElement('div');
    footer.className = 'modal-footer';

    const markBtn = doc.createElement('button');
    markBtn.className = 'btn btn-warning';
    markBtn.textContent = 'Mark as Read';
    footer.appendChild(markBtn);

    const otherBtn = doc.createElement('button');
    otherBtn.className = 'btn btn-danger';
    otherBtn.textContent = 'Postpone Notification';
    footer.appendChild(otherBtn);

    container.appendChild(footer);
    doc.body.appendChild(container);

    const detection = detectCampusDriveModal(doc);
    expect(detection.isModalOpen).toBe(true);
    expect(detection.remindButton).toBe(otherBtn);
  });

  it('returns clean false when no popup exists on page', async () => {
    const doc = document.implementation.createHTMLDocument('Student Dashboard');
    const detection = detectCampusDriveModal(doc);
    expect(detection.isModalOpen).toBe(false);
    expect(detection.remindButton).toBeNull();

    const preflight = await runUmsPreflight(doc);
    expect(preflight.hasBlockingModal).toBe(false);
    expect(preflight.dismissed).toBe(false);
  });

  it('does not falsely detect a modal on normal dashboard with campus text or red buttons', () => {
    const doc = document.implementation.createHTMLDocument('Student Dashboard');
    const banner = doc.createElement('div');
    banner.textContent = 'To check your event QR attendance, click here to view the details.';
    doc.body.appendChild(banner);

    const link = doc.createElement('a');
    link.href = '/drives/placement';
    link.textContent = 'Campus Drive Results 2026';
    doc.body.appendChild(link);

    const redBadge = doc.createElement('span');
    redBadge.className = 'badge btn-danger';
    redBadge.textContent = '7';
    doc.body.appendChild(redBadge);

    const detection = detectCampusDriveModal(doc);
    expect(detection.isModalOpen).toBe(false);
    expect(detection.remindButton).toBeNull();
  });

  it('suppresses re-detection immediately after markCampusModalDismissed()', () => {
    const doc = document.implementation.createHTMLDocument('Student Dashboard');
    const modal = doc.createElement('div');
    modal.className = 'modal show';
    const header = doc.createElement('h4');
    header.textContent = 'Campus Drive Notifications';
    modal.appendChild(header);

    const remindBtn = doc.createElement('button');
    remindBtn.textContent = 'Remaind Me Later';
    modal.appendChild(remindBtn);
    doc.body.appendChild(modal);

    markCampusModalDismissed();
    expect(isCampusModalCoolingDown()).toBe(true);

    const detection = detectCampusDriveModal(doc);
    expect(detection.isModalOpen).toBe(false);
    expect(detection.remindButton).toBeNull();
  });
});
