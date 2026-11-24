import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval('sim tick', { minutes: 20 }, internal.sim.tick, {});
crons.interval('real weather', { hours: 1 }, internal.sim.refreshWeather, {});
crons.interval('job sweep', { minutes: 5 }, internal.jobs.sweep, {});
crons.daily('daily backup', { hourUTC: 9, minuteUTC: 15 }, internal.backup.daily, {});
export default crons;
