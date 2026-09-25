import { Injectable, inject } from '@angular/core';
import { ToastrService } from 'ngx-toastr';

/**
 * The app's one way of saying something transient.
 *
 * It wraps ngx-toastr rather than letting components reach for it directly, so
 * the wording rules live in one place and swapping the library later is a
 * single-file job.
 */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly toastr = inject(ToastrService);

  /** Something failed and the user's view is missing data because of it. */
  error(message: string, title = 'Something went wrong'): void {
    this.toastr.error(message, title, { timeOut: 9000 });
  }

  /** Something is degraded but recovering on its own — no action needed. */
  warn(message: string, title = ''): void {
    this.toastr.warning(message, title, { timeOut: 6000 });
  }

  /** A deliberate action completed. Short: the user already knows what they did. */
  success(message: string, title = ''): void {
    this.toastr.success(message, title, { timeOut: 3000 });
  }

  info(message: string, title = ''): void {
    this.toastr.info(message, title);
  }

  /**
   * Warcraft Logs is rate-limiting us and we are waiting it out.
   *
   * Worth saying out loud: from the outside a throttled app looks like a frozen
   * one, and the honest message ("it is coming back, in about six seconds") is
   * what stops someone reloading and making the throttling worse.
   */
  rateLimited(waitMs: number, attempt: number, attempts: number): void {
    const seconds = Math.max(1, Math.round(waitMs / 1000));
    this.warn(
      `Warcraft Logs is throttling requests. Retrying in ${seconds}s (attempt ${attempt} of ${attempts}).`,
      'Slowing down',
    );
  }
}
