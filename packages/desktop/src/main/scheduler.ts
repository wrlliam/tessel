import { Cron } from 'croner'

export interface ScheduledTrigger {
  tileId: string
  nodeId: string
  pattern: string
}

/** Runs On schedule triggers at their cron times, in the computer's local time zone. */
export class Scheduler {
  private jobs: Cron[] = []

  constructor(private fire: (job: ScheduledTrigger) => void) {}

  set(triggers: ScheduledTrigger[]) {
    this.stop()
    for (const t of triggers) {
      try {
        // `protect` skips a run while the previous one is still going.
        this.jobs.push(new Cron(t.pattern, { protect: true }, () => this.fire(t)))
      } catch {
        // An invalid pattern is reported in the editor; skip it here.
      }
    }
  }

  get size() {
    return this.jobs.length
  }

  stop() {
    for (const job of this.jobs) job.stop()
    this.jobs = []
  }
}
