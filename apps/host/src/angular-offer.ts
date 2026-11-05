import { InjectionToken } from '@angular/core'
import type { LookupOffer } from './lookup-opens.js'

/**
 * What the Angular pane offers under each lookup of its record (0141): the
 * forms each opens in and what a press does, handed in through the
 * injector as the save is, or null where the pane offers none -- a child
 * row's rail. A file of its own for the reason in angular-save.ts.
 */
export const HOST_OFFER = new InjectionToken<LookupOffer | null>('formancy-data-host.offer')
