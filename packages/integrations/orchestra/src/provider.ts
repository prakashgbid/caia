/**
 * Provider base class and interface
 */

import { QueryOptions, Response } from './types'

export interface IProvider {
  name: string
  complete(prompt: string, options?: QueryOptions): Promise<Response>
  stream?(prompt: string, options?: QueryOptions): AsyncGenerator<string>
  healthCheck?(): Promise<boolean>
}

export abstract class Provider implements IProvider {
  abstract name: string
  
  abstract complete(prompt: string, options?: QueryOptions): Promise<Response>
  
  async *stream(prompt: string, options?: QueryOptions): AsyncGenerator<string> {
    // Default implementation - just yield the complete response
    const response = await this.complete(prompt, options)
    yield response.content
  }
  
  async healthCheck(): Promise<boolean> {
    try {
      await this.complete('test', { maxTokens: 1 })
      return true
    } catch {
      return false
    }
  }
}