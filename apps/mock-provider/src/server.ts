import { createApp } from './app';

const port = Number(process.env.PORT || 4010);
createApp().listen(port, '0.0.0.0', () => console.log(`Mock provider listening on ${port}`));

