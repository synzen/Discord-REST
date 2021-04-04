import Queue, { Job } from "bull"
import { RequestInit } from "node-fetch"
import { JobData, JobResponse, REDIS_QUEUE_NAME } from './RESTConsumer'

class RESTProducer {
  private redisUri: string
  private queue: Queue.Queue

  constructor(redisUri: string) {
    this.redisUri = redisUri
    this.queue = new Queue(REDIS_QUEUE_NAME, this.redisUri)
  }

  /**
   * Enqueue a request to Discord's API. If the API response is needed, the fetch method
   * should be used instead of enqueue.
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @param meta Metadata to attach to the job for the Consumer to access
   * @returns The enqueued job
   */
  public async enqueue(route: string, options: RequestInit, meta?: Record<string, unknown>): Promise<Job> {
    const jobData: JobData = {
      route,
      options,
      meta
    }
    const job = await this.queue.add(jobData, {
      removeOnComplete: true,
      removeOnFail: true,
      // Attempts are handled by buckets
      attempts: 1,
    })
    return job
  }

  /**
   * Fetch a resource from Discord's API.
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @param meta Metadata to attach to the job for the Consumer to access
   * @returns Fetch response details
   */
  public async fetch<JSONResponse>(route: string, options: RequestInit, meta?: Record<string, unknown>): Promise<JobResponse<JSONResponse>> {
    const job = await this.enqueue(route, options, meta)
    return job.finished();
  }
}

export default RESTProducer
