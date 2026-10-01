import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello() {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('redis/stats')
  async getRedisStats() {
    return this.appService.getRedisStats();
  }

  @Post('workflows/dispatch')
  async dispatchWorkflow(@Body() body: any) {
    return this.appService.dispatchWorkflow(body);
  }
}
