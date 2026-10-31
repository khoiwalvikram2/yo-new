declare module 'zen-observable' {
  export interface SubscriptionObserver<T> {
    next(value: T): void
    error(err: unknown): void
    complete(): void
    closed: boolean
  }

  export default class Observable<T> {
    constructor(subscriber: (observer: SubscriptionObserver<T>) => void | (() => void))
    subscribe(observer: SubscriptionObserver<T>): { unsubscribe(): void }
  }
}
