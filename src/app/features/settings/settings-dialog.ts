import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';

import { WclAuthService } from '../../core/api/wcl-auth.service';

@Component({
  selector: 'app-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="backdrop"
      role="button"
      tabindex="0"
      (click)="onBackdrop($event)"
      (keyup.escape)="closed.emit()"
    >
      <div class="dialog" role="dialog" aria-label="Warcraft Logs API settings">
        <h2>Warcraft Logs API</h2>
        <p class="hint">
          Create a client at
          <a href="https://www.warcraftlogs.com/api/clients" target="_blank" rel="noreferrer"
            >warcraftlogs.com/api/clients</a
          >
          (any redirect URL works — only the client credentials flow is used). Everything is stored
          in <strong>your browser only</strong> and sent to warcraftlogs.com exclusively.
        </p>

        <label>
          Client ID
          <input
            type="text"
            [value]="clientId()"
            (input)="clientId.set(asInput($event).value)"
            autocomplete="off"
          />
        </label>
        <label>
          Client secret
          <input
            type="password"
            [value]="clientSecret()"
            (input)="clientSecret.set(asInput($event).value)"
            autocomplete="off"
          />
        </label>

        <details>
          <summary>Advanced: paste an access token directly</summary>
          <p class="hint">
            If token fetching fails in your browser, generate a token yourself (e.g. with curl) and
            paste it here.
          </p>
          <label>
            Access token
            <input
              type="password"
              [value]="manualToken()"
              (input)="manualToken.set(asInput($event).value)"
              autocomplete="off"
            />
          </label>
        </details>

        @if (saved()) {
          <p class="saved">Saved ✓</p>
        }

        <div class="actions">
          <button class="danger" (click)="clear()">Clear all</button>
          <span class="spacer"></span>
          <button (click)="closed.emit()">Close</button>
          <button class="primary" (click)="save()">Save</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }

    .dialog {
      width: min(480px, 92vw);
      background: var(--bg-1);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 24px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    h2 {
      margin: 0;
      font-size: 18px;
    }

    .hint {
      margin: 0;
      color: var(--text-2);
      font-size: 12.5px;

      a {
        color: var(--accent);
      }
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
      color: var(--text-1);
    }

    details summary {
      cursor: pointer;
      color: var(--text-2);
      font-size: 13px;
    }

    details label {
      margin-top: 8px;
    }

    .saved {
      margin: 0;
      color: var(--success);
      font-size: 13px;
    }

    .actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;

      .spacer {
        flex: 1;
      }

      .danger {
        border-color: rgba(229, 72, 77, 0.5);
        color: #ff9b9e;
      }
    }
  `,
})
export class SettingsDialog {
  private readonly auth = inject(WclAuthService);
  readonly closed = output<void>();

  protected readonly clientId = signal(this.auth.credentials()?.clientId ?? '');
  protected readonly clientSecret = signal(this.auth.credentials()?.clientSecret ?? '');
  protected readonly manualToken = signal('');
  protected readonly saved = signal(false);

  protected asInput(event: Event): HTMLInputElement {
    return event.target as HTMLInputElement;
  }

  /** Closes only when the dimmed area itself is clicked, not the dialog content. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }

  protected save(): void {
    const id = this.clientId().trim();
    const secret = this.clientSecret().trim();
    if (id && secret) {
      this.auth.setCredentials({ clientId: id, clientSecret: secret });
    }
    const token = this.manualToken().trim();
    if (token) {
      this.auth.setManualToken(token);
    }
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2000);
  }

  protected clear(): void {
    this.auth.clearAll();
    this.clientId.set('');
    this.clientSecret.set('');
    this.manualToken.set('');
  }
}
