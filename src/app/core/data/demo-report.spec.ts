import { buildDemoReport } from './demo-report';

describe('buildDemoReport', () => {
  const demo = buildDemoReport();

  it('produces a report with pulls ending in a kill', () => {
    expect(demo.report.fights.length).toBeGreaterThan(3);
    expect(demo.report.fights.at(-1)?.kill).toBe(true);
    expect(demo.report.fights.slice(0, -1).every((f) => !f.kill)).toBe(true);
  });

  it('provides events for every fight', () => {
    for (const fight of demo.report.fights) {
      const events = demo.eventsByFight.get(fight.id);
      expect(events).toBeDefined();
      expect(events!.friendlyCasts.length).toBeGreaterThan(0);
      expect(events!.enemyCasts.length).toBeGreaterThan(0);
      // Every event lies within its fight's bounds.
      for (const cast of [...events!.friendlyCasts, ...events!.enemyCasts]) {
        expect(cast.timestamp).toBeGreaterThanOrEqual(fight.startTime);
        expect(cast.timestamp).toBeLessThanOrEqual(fight.endTime);
      }
    }
  });

  it('is deterministic', () => {
    const again = buildDemoReport();
    expect(again.eventsByFight.get(1)?.friendlyCasts).toEqual(
      demo.eventsByFight.get(1)?.friendlyCasts,
    );
  });

  it('names every ability referenced by events', () => {
    const events = demo.eventsByFight.get(1)!;
    for (const cast of [...events.friendlyCasts, ...events.enemyCasts]) {
      expect(demo.report.abilities.get(cast.abilityGameID)).toBeDefined();
    }
  });
});
