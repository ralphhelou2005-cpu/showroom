import { SPECS, surfaceJob } from './textures.js';

self.onmessage = ({ data: { name } }) => {
  const spec = SPECS[name];
  const job = surfaceJob(spec.kind, spec.full, spec.P, spec.normal);
  let step = job.next();
  while (!step.done) step = job.next();
  const { size, color, rough, normal } = step.value;
  postMessage({ name, size, color: color.buffer, rough: rough.buffer, normal: normal.buffer }, [color.buffer, rough.buffer, normal.buffer]);
};
