import dayjs, { type PluginFunc } from 'dayjs';
import 'dayjs/locale/th';
import buddhistEra from 'dayjs/plugin/buddhistEra';
import customParseFormat from 'dayjs/plugin/customParseFormat';

/** What dayjs hands to `parse` on its prototype; the plugin API leaves it untyped. */
type ParseConfig = { date: unknown; args: IArguments | unknown[] };

/**
 * buddhistEra only formats BBBB. This parses it too, so a Thai DatePicker accepts a typed Buddhist
 * Era date: the year becomes CE before customParseFormat reads the text. The year is read where
 * BBBB sits in the format, so every token before it must be fixed width (DD, MM), as in
 * ./antd-locale.
 */
const parseBuddhistEra: PluginFunc = (_, dayjsClass) => {
  const proto = dayjsClass.prototype as unknown as { parse(cfg: ParseConfig): void };
  const parse = proto.parse;
  proto.parse = function (cfg) {
    const format = cfg.args[1];
    const start = typeof format === 'string' ? format.indexOf('BBBB') : -1;
    const text = typeof cfg.date === 'string' ? cfg.date : '';
    const year = start >= 0 ? text.slice(start, start + 4) : '';
    if (/^\d{4}$/.test(year)) {
      cfg.date = text.slice(0, start) + String(Number(year) - 543).padStart(4, '0') + text.slice(start + 4);
      cfg.args[1] = (format as string).replace('BBBB', 'YYYY');
    }
    parse.call(this, cfg);
  };
};

// customParseFormat goes first so the BBBB step runs before it. dayjs installs each plugin once,
// so AntD extending it again later changes nothing.
dayjs.extend(customParseFormat);
dayjs.extend(buddhistEra);
dayjs.extend(parseBuddhistEra);

export default dayjs;
