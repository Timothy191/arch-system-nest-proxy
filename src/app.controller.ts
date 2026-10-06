import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AppService } from './app.service.js';
import { DispatchWorkflowDto } from './dto/dispatch-workflow.dto.js';
import { ApiKeyGuard } from './common/api-key.guard.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello() {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('redis/stats')
  async getRedisStats() {
    return this.appService.getRedisStats();
  }

  @Get('workflows/jobs/:jobId')
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.appService.getJobStatus(jobId);
  }

  @Post('workflows/dispatch')
  @UseGuards(ApiKeyGuard)
  async dispatchWorkflow(@Body() body: DispatchWorkflowDto) {
    return this.appService.dispatchWorkflow(body);
  }
}
