# ResistanceAvalon

Serverless web implementation of **The Resistance: Avalon** for mobile and desktop browsers.

The project is built around one goal: let 5 to 10 players run an Avalon session on their own devices without a human moderator. Room creation, role distribution, voting, mission resolution, assassin phase, and result reveal are handled in the app.

## Current State

This repository is already beyond prototype stage.

- Play flow implemented: home -> lobby -> role reveal -> team proposal -> voting -> mission -> assassin -> result
- Realtime backend implemented with Firebase Realtime Database + Anonymous Auth
- GitHub Pages deployment workflow exists
- Extra gameplay support exists for:
  - host-managed bots
  - host-only force-kick controls in the lobby
  - vote history
  - collapsible result vote history by mission
  - compact 2-column lobby/game player layouts
  - host treated as always ready in lobby
  - role composition board split into good/evil sections
  - normalized role config guards by player count
  - optimistic waiting-state UI after role reveal / vote result / mission result confirmations
  - per-phase timers
  - floating chat
  - audio/BGM

## Stack

- Vite
- Vanilla JavaScript (ES modules)
- Firebase Realtime Database
- Firebase Anonymous Authentication
- GitHub Pages
- GitHub Actions

## Project Structure

```text
src/
  config/
    gameConfig.js        Game constants, roles, mission sizes, timer presets
  game/
    GameEngine.js        Host-side state machine and phase transitions
    RoleManager.js       Role assignment and visible-info generation
    VoteManager.js       Vote aggregation
    MissionManager.js    Mission card judgment
    AssassinManager.js   Merlin assassination flow
  services/
    RoomService.js       Room lifecycle and Firebase room access
    PlayerService.js     Presence, vote, mission, ready, assassination actions
    BotService.js        Host-managed bot players
    ChatService.js       Floating in-game chat
    AudioService.js      Audio and BGM
  views/
    HomeView.js
    LobbyView.js
    GameView.js
    ResultView.js
  components/
    MissionTrack.js
    PlayerList.js
    VoteResult.js
```

## Core Runtime Model

- The room host acts as the game engine.
- The host client listens for Firebase actions and writes authoritative `gameState` transitions.
- Private role data is stored under `privateData/{roomCode}/{playerId}`.
- Public room state is stored under `rooms/{roomCode}`.

This means the game is lightweight and serverless, but host migration and edge-case handling matter a lot.

## Local Development

1. Install dependencies:

```sh
npm ci
```

2. Create or update `.env`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
```

3. Run:

```sh
npm run dev
```

4. Open the local Vite URL in two or more separate browser sessions.
   Use separate browsers or incognito windows for multiplayer QA.

## Automated Validation

This repo now has two lightweight validation paths that do not require a browser:

- `npm run test:sim`
  Runs 5-player through 10-player full-game simulations repeatedly and asserts that the game always reaches a valid terminal state.
- `npm run test:lobby`
  Runs focused lobby-state invariant checks for multiplayer regressions such as:
  - guest `READY` state surviving unrelated room updates
  - guest `READY` state surviving reconnect / presence flips
  - host exclusion from ready requirements
  - host migration recomputing the correct ready set
  - bot add/remove and replay reset behavior
  - force-kicked players being removed from both the player roster and ready state
  - only active players being used when a game starts
  - role-config slot limits being normalized for smaller player counts
- `npm run test:game-phases`
  Runs focused phase-ready checks for "everyone must press next" flows after role reveal, vote result, and mission result.
  It validates ready-count aggregation and UI labels such as `대기 중 (2/x)`, including optimistic local progress immediately after a player confirms.
- `npm run test:button-labels`
  Runs reusable button-label checks across 5-player through 10-player setups.
  It validates lobby start labels, team proposal count labels for each mission, role reveal / voting / vote-result / mission-result button copy, and vote completion messages.
- `npm run test:result-replay`
  Runs replay routing checks so guests return to the lobby when the host resets the room after a finished game.
- `npm run test:ci`
  Runs both validation suites and then `vite build`.

Quick local commands:

```sh
npm run simulate:quick
npm run test:lobby
npm run test:game-phases
npm run test:button-labels
npm run test:result-replay
npm run test:ci
```

Relevant sources:

- [src/sim/GameSimulator.js](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/src/sim/GameSimulator.js)
- [src/lobby/lobbyState.js](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/src/lobby/lobbyState.js)
- [scripts/simulate-games.mjs](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/scripts/simulate-games.mjs)
- [scripts/check-lobby-invariants.mjs](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/scripts/check-lobby-invariants.mjs)
- [scripts/check-game-phase-invariants.mjs](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/scripts/check-game-phase-invariants.mjs)
- [scripts/check-result-replay-invariants.mjs](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/scripts/check-result-replay-invariants.mjs)

## Firebase Setup

This repo uses:

- Firebase Anonymous Auth
- Firebase Realtime Database

Rules source:

- [database.rules.json](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/database.rules.json)

CLI config:

- [firebase.json](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/firebase.json)
- [.firebaserc](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/.firebaserc)

Deploy rules:

```sh
firebase deploy --only database
```

Detailed Firebase notes:

- [FIREBASE_SETUP.md](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/FIREBASE_SETUP.md)

## GitHub Pages Deployment

Deploy workflow:

- [.github/workflows/deploy.yml](/home/kimdohyeong/Working_kdh/1_Projects/Y2026/PJT005_Games/ResistanceAvalon/.github/workflows/deploy.yml)

Expected branch:

- `claude/main`

Required GitHub Actions secrets:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`

Validation on push:

- The GitHub Actions workflow now runs simulation checks and lobby invariant checks before building and deploying.

## QA Priorities

The most important manual QA scenarios are:

1. 5-player happy path from room creation to result
2. 7+ player fourth mission rule (`2 fails required`)
3. Host leaves during lobby
4. Host leaves during active game
5. Non-host disconnects during vote
6. Non-host disconnects during mission
7. Replay after result
8. Timer expiry in proposal/vote/mission/assassination
9. Vote-history toggle on/off
10. Host-managed bot add/remove flow
11. 2-column lobby/game player layout readability on mobile
12. Vote submit / next-confirm waiting UI copy
13. Role composition visibility for both host and guests
14. Host force-kick flow in lobby on both mobile and desktop
15. Result screen `홈으로` fully leaving the room before replay starts

## Known Architectural Constraints

- The host client is authoritative for game progression.
- Multiplayer QA should not be done with multiple tabs in the same browser session.
- Firebase rules and client-side checks must both be correct; UI-only restrictions are not enough.

## Source Of Truth

The source of truth is now the implemented code plus this README.
