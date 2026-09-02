# ONEE Developer Guide

## Setup & Development Workflow

### Frontend (Extension)

```bash
cd extension
npm install

# Run watch build for development
npm run dev

# Run unit tests
npm run test

# Build production unpacked extension into dist/
npm run build
```

### Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run server in reload mode
uvicorn app.main:app --reload --port 8000

# Run backend tests
pytest
```

## Adding New Features

1. **New Attendance Tools**:
   - Add mathematical formula to `extension/src/shared/attendanceCalculator.ts`.
   - Add Python counterpart and tool definition to `backend/app/agent/tools.py`.
   - Write corresponding unit tests in `extension/src/tests/` and `backend/tests/`.
2. **DOM Parser Extensions**:
   - If UMS updates its HTML hierarchy, add a new strategy or selector in `extension/src/content/umsAttendanceParser.ts`.
   - Add an HTML fixture into `extension/src/tests/fixtures/` and test.
