// The slice of docling-serve's `json_content` (a `DoclingDocument`) that
// `renderDocument` needs. docling's own type is much larger; this models only
// the reading-order tree (`body` + `texts`/`groups`/`tables`, resolved by
// `self_ref` path) and the per-item page provenance that `renderDocument`
// walks. See https://github.com/docling-project/docling-core for the full
// schema.

export interface DoclingProvenance {
  page_no: number;
}

export interface DoclingRef {
  $ref: string;
}

export interface DoclingTextItem {
  self_ref: string;
  label: string;
  text: string;
  // Only set on `section_header` items; 1 is the outermost.
  level?: number;
  prov?: DoclingProvenance[];
}

export interface DoclingTableCell {
  text: string;
  start_row_offset_idx?: number;
  start_col_offset_idx?: number;
}

export interface DoclingTableItem {
  self_ref: string;
  label: 'table';
  prov?: DoclingProvenance[];
  data?: {
    table_cells?: DoclingTableCell[];
    num_rows?: number;
    num_cols?: number;
  };
}

export interface DoclingGroupItem {
  self_ref: string;
  label?: string;
  children: DoclingRef[];
}

export interface DoclingDocument {
  texts: DoclingTextItem[];
  groups: DoclingGroupItem[];
  tables: DoclingTableItem[];
  pictures: unknown[];
  body: DoclingGroupItem;
}
