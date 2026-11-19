export type DomainErrorCode = 'not_found' | 'conflict' | 'bad_request' | 'unauthorized' | 'forbidden' | 'internal'

export class DomainError extends Error {
  readonly code: DomainErrorCode

  constructor(message: string, code: DomainErrorCode) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
