// Finish Room (D-200, D-201; UI-47, UI-52): one press plays the rest of the fight. The server answers with every round (POST /api/dungeon/finish);
// the client replays them on the same stage at FINISH_SPEED times the speed of a tapped round. Pure helpers: the logic of the button and of the answer.
export const FINISH_SPEED = 3;       // the one place of the replay speed: a wait of a tapped round is divided by this
export const FINISH_LABEL_ROW = 700; // a control row this wide (measured, CSS px) shows the label next to the icon; a narrower row shows the icon only
export const finishNotice = (round) => `Finishing the room · Round ${Number(round || 0) + 1}`;
// The wait of one step of the animation: a tapped round keeps its time, a finishing replay takes 1/FINISH_SPEED of it, a skip takes none.
export const waitMs = (ms, { finishing = false, skip = false } = {}) => (skip ? 0 : finishing ? Math.round(ms / FINISH_SPEED) : ms);
// The state of the button. hidden: the server code is older than the route (404 finish_unavailable). A support that picks a target disables it
// (phones hide it with Music and Auto, D-155: that part is CSS). While it finishes it is the Skip button and stays pressable.
export const finishButton = ({ busy = false, finishing = false, picking = false, unavailable = false } = {}) => ({
  hidden: !!unavailable,
  skip: !!finishing,
  disabled: !finishing && (!!busy || !!picking),
  label: finishing ? 'Skip' : 'Finish Room',
});
// Auto is greyed while a room finishes and keeps its on/off state (Finish Room never changes it).
export const autoDisabled = (finishing) => !!finishing;
// What an answer of the server means for the screen. error: a refused or lost call (the fight goes on, a toast shows the reason);
// unavailable: old server (404 finish_unavailable): the button is hidden; over: the run ended (lost or the round limit: the run-over screen);
// next: the room was won and the step is not a fight (reward, floor, cleared); fight: the call stopped inside the fight (a refused action).
export function finishAnswer(r) {
  if (!r || !r.ok) {
    if (r?.error === 'finish_unavailable') return { kind: 'unavailable', rounds: [] };
    return { kind: 'error', message: r?.message || 'That did not work.', rounds: [] };
  }
  const rounds = Array.isArray(r.rounds) ? r.rounds : [];
  const kind = r.status === 'over' || r.ended ? 'over' : r.state?.phase && r.state.phase !== 'fight' ? 'next' : 'fight';
  return { kind, outcome: r.outcome ?? null, rounds, message: r.error?.message || '' };
}
