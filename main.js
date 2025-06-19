const { Plugin, Setting, PluginSettingTab } = require('obsidian');

const DEFAULT_SETTINGS = {
    ocrLanguage: 'rus+eng',
    enhanceContrast: true,
    toGrayscale: false
};

function processImage(img, { enhanceContrast, toGrayscale }) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let data = imageData.data;
    // Грейскейл
    if (toGrayscale) {
        for (let i = 0; i < data.length; i += 4) {
            const avg = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
            data[i] = data[i+1] = data[i+2] = avg;
        }
    }
    // Контраст
    if (enhanceContrast) {
        const contrast = 40;
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
        for (let i = 0; i < data.length; i += 4) {
            data[i] = factor * (data[i] - 128) + 128;
            data[i+1] = factor * (data[i+1] - 128) + 128;
            data[i+2] = factor * (data[i+2] - 128) + 128;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
}

function extractBusinessCardData(text) {
    const data = {
        company: '',
        fullName: '',
        phone: '',
        email: '',
        address: '',
        position: '',
        website: '',
        rawText: text
    };
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // 1. Должность и ФИО подряд
    for (let i = 0; i < lines.length - 1; i++) {
        if (/(представитель|руководитель|отдел|менеджер|директор|sales|manager|head|chief)/i.test(lines[i])) {
            // Следующая строка — ФИО (3 слова с большой буквы, допускаем пробелы внутри)
            if (/([А-ЯЁA-Z][а-яёa-z]+\s*){2,}[А-ЯЁA-Z][а-яёa-z]+/.test(lines[i+1].replace(/\s+/g, ' '))) {
                data.position = lines[i];
                data.fullName = lines[i+1].replace(/\s+/g, ' ');
            }
        }
    }
    // Если не нашли, ищем ФИО по всему тексту
    if (!data.fullName) {
        for (const line of lines) {
            if (/([А-ЯЁA-Z][а-яёa-z]+\s*){2,}[А-ЯЁA-Z][а-яёa-z]+/.test(line.replace(/\s+/g, ' '))) {
                data.fullName = line.replace(/\s+/g, ' ');
                break;
            }
        }
    }

    // 2. Компания: ищем строку с ООО/ЗАО/ОАО/000/кавычки/домен, но без ФИО
    for (const line of lines) {
        if ((/ООО|ЗАО|ОАО|ПАО|АО|ИП|000|«|"|www\./i.test(line)) && (!data.fullName || !line.includes(data.fullName.split(' ')[0]))) {
            data.company = line;
            break;
        }
    }

    // 3. Адрес: ищем строку с индексом и городом
    for (const line of lines) {
        if (/(\d{6}.*Санкт-Петербург|\d{6}.*Москва|г\.|город|ул\.|улица|пр\.|проспект|пер\.|переулок|офис)/i.test(line)) {
            data.address = line;
            break;
        }
    }

    // 4. Должность: если не нашли, ищем по ключевым словам
    if (!data.position) {
        for (const line of lines) {
            if (/(представитель|руководитель|отдел|менеджер|директор|sales|manager|head|chief)/i.test(line)) {
                data.position = line;
                break;
            }
        }
    }

    // 5. Сайт: ищем строку с www или http
    for (const line of lines) {
        if (/www\.|http/i.test(line)) {
            data.website = line;
            break;
        }
    }

    // 6. Телефон (берём первый найденный)
    const phoneMatch = text.match(/(?:\+7|8)[\s\-]?(\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})/);
    if (phoneMatch) data.phone = phoneMatch[0];

    // 7. Email
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) data.email = emailMatch[0];

    return data;
}

function createNoteContent(data) {
    return `# Визитка: ${data.fullName || 'Не определено'}\n\n**Компания:** ${data.company || 'Не определено'}\n**ФИО:** ${data.fullName || 'Не определено'}\n**Должность:** ${data.position || 'Не определено'}\n**Телефон:** ${data.phone || 'Не определено'}\n**Email:** ${data.email || 'Не определено'}\n**Адрес:** ${data.address || 'Не определено'}\n**Сайт:** ${data.website || 'Не определено'}\n\n---\n**Исходный текст:**\n${data.rawText}\n`;
}

class EditCardModal {
    constructor(app, card, onSave, imageDataUrl) {
        this.app = app;
        this.card = card;
        this.onSave = onSave;
        this.modal = null;
        this.imageDataUrl = imageDataUrl;
    }
    open() {
        this.modal = document.createElement('div');
        this.modal.className = 'modal mod-settings';
        this.modal.style = 'position:fixed;top:10vh;left:50%;transform:translateX(-50%);z-index:1000;background:var(--background-primary);padding:2em;border-radius:8px;box-shadow:0 2px 8px #0008;max-width:90vw;';
        this.modal.innerHTML = `
            <h2>Проверьте и исправьте данные визитки</h2>
            <div style="text-align:center;margin-bottom:1em"><img src="${this.imageDataUrl}" style="max-width:300px;max-height:200px;border:1px solid #ccc;border-radius:4px;"></div>
            <label>ФИО:<br><input type="text" id="fio" value="${this.card.fullName || ''}" style="width:100%"></label><br>
            <label>Компания:<br><input type="text" id="company" value="${this.card.company || ''}" style="width:100%"></label><br>
            <label>Должность:<br><input type="text" id="position" value="${this.card.position || ''}" style="width:100%"></label><br>
            <label>Телефон:<br><input type="text" id="phone" value="${this.card.phone || ''}" style="width:100%"></label><br>
            <label>Email:<br><input type="text" id="email" value="${this.card.email || ''}" style="width:100%"></label><br>
            <label>Адрес:<br><input type="text" id="address" value="${this.card.address || ''}" style="width:100%"></label><br>
            <label>Сайт:<br><input type="text" id="website" value="${this.card.website || ''}" style="width:100%"></label><br>
            <label>Исходный текст:<br><textarea id="rawText" style="width:100%;height:5em">${this.card.rawText || ''}</textarea></label><br>
            <div style="text-align:right;margin-top:1em">
                <button id="cancelBtn">Отмена</button>
                <button id="saveBtn" style="margin-left:1em">Сохранить</button>
            </div>
        `;
        document.body.appendChild(this.modal);
        this.modal.querySelector('#cancelBtn').onclick = () => this.close();
        this.modal.querySelector('#saveBtn').onclick = () => {
            this.card.fullName = this.modal.querySelector('#fio').value;
            this.card.company = this.modal.querySelector('#company').value;
            this.card.position = this.modal.querySelector('#position').value;
            this.card.phone = this.modal.querySelector('#phone').value;
            this.card.email = this.modal.querySelector('#email').value;
            this.card.address = this.modal.querySelector('#address').value;
            this.card.website = this.modal.querySelector('#website').value;
            this.card.rawText = this.modal.querySelector('#rawText').value;
            this.close();
            this.onSave(this.card);
        };
    }
    close() {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
    }
}

class BusinessCardOCRSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Настройки Business Card OCR' });
        new Setting(containerEl)
            .setName('Язык OCR')
            .setDesc('Языки для распознавания текста (например, rus, eng, rus+eng)')
            .addText(text => text
                .setPlaceholder('rus+eng')
                .setValue(this.plugin.settings.ocrLanguage)
                .onChange(async (value) => {
                    this.plugin.settings.ocrLanguage = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Улучшать контраст')
            .setDesc('Автоматически повышать контраст изображения перед распознаванием')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enhanceContrast)
                .onChange(async (value) => {
                    this.plugin.settings.enhanceContrast = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Переводить в ч/б')
            .setDesc('Преобразовывать изображение в оттенки серого перед распознаванием')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.toGrayscale)
                .onChange(async (value) => {
                    this.plugin.settings.toGrayscale = value;
                    await this.plugin.saveSettings();
                }));
    }
}

module.exports = class extends Plugin {
    async onload() {
        await this.loadSettings();
        new require('obsidian').Notice('Business Card OCR New: Плагин успешно загружен!');
        this.addRibbonIcon('image', 'Обработать визитку (OCR)', async () => {
            await this.processBusinessCard();
        });
        this.addCommand({
            id: 'process-business-card',
            name: 'Обработать визитку (OCR)',
            callback: async () => {
                await this.processBusinessCard();
            }
        });
        this.addSettingTab(new BusinessCardOCRSettingTab(this.app, this));
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
    async processBusinessCard() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.jpg,.jpeg,.png,.webp';
        input.onchange = async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                new require('obsidian').Notice('Файл не выбран');
                return;
            }
            new require('obsidian').Notice('Распознаю текст...');
            if (!window.Tesseract) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/tesseract.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }
            // Читаем файл как dataURL
            const reader = new FileReader();
            reader.onload = async () => {
                const imageDataUrl = reader.result;
                // Создаём img для canvas
                const img = new window.Image();
                img.onload = async () => {
                    // Обработка изображения
                    let processedDataUrl = imageDataUrl;
                    if (this.settings.enhanceContrast || this.settings.toGrayscale) {
                        processedDataUrl = processImage(img, {
                            enhanceContrast: this.settings.enhanceContrast,
                            toGrayscale: this.settings.toGrayscale
                        });
                    }
                    // OCR
                    window.Tesseract.recognize(
                        processedDataUrl,
                        this.settings.ocrLanguage,
                        { logger: m => {/* можно добавить прогресс */} }
                    ).then(async ({ data: { text } }) => {
                        if (!text || text.trim().length < 5) {
                            new require('obsidian').Notice('Текст не распознан');
                            return;
                        }
                        const card = extractBusinessCardData(text);
                        (new EditCardModal(this.app, card, async (editedCard) => {
                            const fileName = (editedCard.fullName || editedCard.company || 'Визитка') + ' ' + new Date().toISOString().slice(0,10);
                            const safeName = fileName.replace(/[^a-zA-Zа-яА-Я0-9\-_ ]/g, '').replace(/\s+/g, ' ').trim();
                            const notePath = safeName + '.md';
                            await this.app.vault.create(notePath, createNoteContent(editedCard));
                            new require('obsidian').Notice('Заметка создана: ' + notePath);
                        }, processedDataUrl)).open();
                    }).catch(err => {
                        new require('obsidian').Notice('Ошибка OCR: ' + err.message);
                    });
                };
                img.src = imageDataUrl;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }
}; 