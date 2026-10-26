import { PipeTransform } from '@nestjs/common';
import { notFound } from './app-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Malformed ids are indistinguishable from missing ones (404), so ids can't be probed. */
export class UuidPipe implements PipeTransform<string, string> {
  constructor(private what = 'Resource') {}
  transform(value: string) {
    if (!UUID.test(value)) throw notFound(this.what);
    return value;
  }
}
