import { Controller, HttpCode, Inject, Param, Put, Req } from '@nestjs/common';
import { FakeObjectStorage } from '@scriptorium/providers';
import { OBJECT_STORAGE, Public } from '@scriptorium/server-core';

interface RawRequest {
  rawBody?: Buffer;
}

/**
 * Dev-only stand-in for S3. `AppModule` mounts this route only when
 * `PROVIDER_MODE=fake`, and the {@link FakeObjectStorage} presigned PUT URL
 * points straight at it, so the browser upload flow (upload-url -> PUT ->
 * POST /books) works end-to-end with no real bucket. It records the object's
 * size from the received bytes, exactly as a later S3 `HEAD` would report it.
 */
@Controller('_dev/uploads')
export class DevUploadsController {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: FakeObjectStorage,
  ) {}

  @Public()
  @Put('*path')
  @HttpCode(200)
  async put(
    @Param('path') path: string | string[],
    @Req() req: RawRequest,
  ): Promise<{ ok: true }> {
    const key = Array.isArray(path) ? path.join('/') : path;
    const body = req.rawBody ?? Buffer.alloc(0);
    await this.storage.putObject(key, body, 'application/pdf');
    return { ok: true };
  }
}
