import { InjectionToken } from '@angular/core'

/**
 * What the Angular pane's submit says: Save, or Done on a row saved with
 * its record, which sends nothing (0155). Handed in through the injector
 * as the save is, in a file of its own for the reason in angular-save.ts.
 */
export const HOST_LABEL = new InjectionToken<string>('formancy-data-host.label')
