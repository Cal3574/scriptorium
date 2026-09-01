import { ProblemException } from '@scriptorium/server-core';

// The upload-handoff domain errors, each with the stable `code` the client
// switches on. Grouped here so the endpoint reads as a list of guard clauses.

export class NotAPdfException extends ProblemException {
  constructor() {
    super(
      'not_a_pdf',
      400,
      'Not a PDF',
      'Only application/pdf uploads are accepted.',
    );
  }
}

export class FileTooLargeException extends ProblemException {
  constructor(maxBytes: number) {
    super(
      'file_too_large',
      400,
      'File too large',
      `The upload exceeds the ${maxBytes}-byte limit.`,
    );
  }
}

export class S3KeyMismatchException extends ProblemException {
  constructor() {
    super(
      's3_key_mismatch',
      400,
      'Storage key mismatch',
      'The s3Key is not under your upload prefix.',
    );
  }
}

export class UploadNotFoundException extends ProblemException {
  constructor() {
    super(
      'upload_not_found',
      404,
      'Upload not found',
      'No uploaded object was found at that key.',
    );
  }
}

export class FileSizeMismatchException extends ProblemException {
  constructor() {
    super(
      'file_size_mismatch',
      400,
      'File size mismatch',
      'The uploaded object size does not match fileSizeBytes.',
    );
  }
}
