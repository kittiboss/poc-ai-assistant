import type { Locale as XLocale } from '@ant-design/x/es/locale';
import xEnUS from '@ant-design/x/locale/en_US';
import enUS from 'antd/locale/en_US';
import thTH from 'antd/locale/th_TH';
import type { Locale } from './config';

// Ant Design X ships no Thai locale, so its strings are translated here.
const xThTH: XLocale = {
  ...thTH,
  locale: 'th',
  Conversations: { create: 'แชทใหม่' },
  Sender: { stopLoading: 'หยุดสร้างคำตอบ', speechRecording: 'กำลังบันทึกเสียง' },
  Actions: {
    feedbackLike: 'ถูกใจ',
    feedbackDislike: 'ไม่ถูกใจ',
    audio: 'เล่นเสียง',
    audioRunning: 'กำลังเล่นเสียง',
    audioError: 'เล่นเสียงไม่สำเร็จ',
    audioLoading: 'กำลังโหลดเสียง',
  },
  Bubble: { editableOk: 'ตกลง', editableCancel: 'ยกเลิก' },
  Mermaid: {
    zoomIn: 'ขยาย',
    zoomOut: 'ย่อ',
    zoomReset: 'รีเซ็ต',
    download: 'ดาวน์โหลด',
    code: 'โค้ด',
    image: 'รูปภาพ',
  },
  Folder: {
    selectFile: 'กรุณาเลือกไฟล์',
    loadError: 'โหลดไฟล์ไม่สำเร็จ',
    noService: 'ยังไม่ได้ตั้งค่าบริการอ่านไฟล์',
    loadFailed: 'โหลดไฟล์ไม่สำเร็จ',
  },
};

/** AntD and Ant Design X strings for each app locale. */
export const antdLocales: Record<Locale, XLocale> = {
  th: xThTH,
  en: { ...enUS, ...xEnUS },
};
