import { TaskService } from './task.service';

describe('TaskService fail-closed task claims', () => {
  const service = new TaskService();

  it('does not expose unverified task definitions', async () => {
    await expect(service.list('user-1')).resolves.toEqual([]);
  });

  it('rejects direct reward claims until server-side behavior evidence exists', async () => {
    await expect(service.complete('task-1', 'user-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TASK_CLAIM_UNAVAILABLE' }),
    });
  });
});
