import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideToastr } from 'ngx-toastr';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    /*
     * Bottom-right keeps toasts clear of the app bar and the context bar, which
     * is where the controls people are actually using live. Duplicates are
     * suppressed because a failing fetch is usually a failing fetch per pull:
     * twenty identical toasts say nothing that one does not.
     */
    provideToastr({
      positionClass: 'toast-bottom-right',
      timeOut: 5000,
      extendedTimeOut: 2000,
      closeButton: true,
      progressBar: true,
      preventDuplicates: true,
      countDuplicates: true,
      resetTimeoutOnDuplicate: true,
      newestOnTop: true,
      maxOpened: 4,
      autoDismiss: true,
    }),
  ],
};
