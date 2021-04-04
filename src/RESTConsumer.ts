import RESTHandler, { RESTHandlerOptions } from "./RESTHandler";
import Queue from 'bull'
import { RequestInit, Response } from "node-fetch";

type JobData = {
  route: string
  options: RequestInit
}

/**
 * Used to consume and enqueue Discord API requests. There should only ever be one consumer that's
 * executing requests across all services for proper rate limit handling.
 * 
 * For sending API requests to the consumer, the RESTProducer should be used instead.
 */
class RESTConsumer {
  /**
   * The Redis URI for the queue handler.
   */
  private redisUri: string
  /**
   * The queue that handles requests to Discord API. Requests are delayed according to received
   * rate limits from Discord, and has concurrncy throttled to 20/sec.
   */
  private queue: Queue.Queue
  /**
   * The handler that will actually run the API requests.
   */
  private handler: RESTHandler
  /**
   * Timer used to coordinate when the queue is blocked and unblocked.
   */
  private queueBlockTimer: NodeJS.Timer|null = null;

  constructor(redisUri: string, options?: RESTHandlerOptions) {
    this.redisUri = redisUri
    this.handler = new RESTHandler(options)
    this.queue = new Queue('discord-rest', this.redisUri, {
      limiter: {
        // 20/sec is around the limit suggested by Discord
        // https://discord.com/developers/docs/topics/rate-limits
        max: 20,
        duration: 1000
      }
    })
    this.queue.process(20, ({ data }: { data: JobData }) => this.handler.fetch(data.route, data.options))
    this.handler.on('invalidRequestsThreshold', async () => {
      // Block all buckets for 10 min. 10 min is the value given by Discord after a global limit hit.
      await this.blockGloballyByDuration(1000 * 60 * 10)
    })
    this.handler.on('globalRateLimit', async (apiRequest, blockDurationMs) => {
      await this.blockGloballyByDuration(blockDurationMs)
    })
  }

  /**
   * Blocks all queued API requests and buckets for a duration
   * If there's already a timer, the previous timer is cleared
   * and is recreated
   */
  private async blockGloballyByDuration (durationMs: number) {
    this.handler.blockBucketsByDuration(durationMs)
    if (this.queueBlockTimer) {
      clearTimeout(this.queueBlockTimer)
    }
    await this.queue.pause()
    this.queueBlockTimer = setTimeout(async () => {
      await this.queue.resume()
      this.queueBlockTimer = null
    }, durationMs)
  }

  /**
   * Fetch a resource from Discord's API.
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @returns node-fetch response
   */
  public async enqueue(route: string, options: RequestInit): Promise<Response> {
    const jobData: JobData = {
      route,
      options
    }
    const job = await this.queue.add(jobData, {
      removeOnComplete: true,
      removeOnFail: true,
      // Attempts are handled by buckets
      attempts: 1,
    })
    return job.finished()
  }
}

export default RESTConsumer
