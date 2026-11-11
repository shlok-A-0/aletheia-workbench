import React from 'react';

/** React Flow and ELK are heavy; load them only when a schematic is shown. */
export const SchematicView = React.lazy(() => import('../../schematic/SchematicView'));
