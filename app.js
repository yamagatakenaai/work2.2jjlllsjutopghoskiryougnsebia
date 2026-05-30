// Google Apps Script (GAS) の Web API URL
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxk1fFGHDlf7mUSZvmph67vr_bCx24YbaLkPTPJOAVb7AQxQUkfQ53BCC8q2YTP8XCO/exec';

document.addEventListener('DOMContentLoaded', () => {
    // 既存UI要素
    const btnIn = document.getElementById('btn-in');
    const btnOut = document.getElementById('btn-out');
    const statusMessage = document.getElementById('status-message');
    const actionButtons = document.getElementById('action-buttons');
    const confirmSection = document.getElementById('confirm-section');
    const confirmText = document.getElementById('confirm-text');
    const datetimeInput = document.getElementById('datetime-input');
    const btnConfirm = document.getElementById('btn-confirm');
    const btnCancel = document.getElementById('btn-cancel');
    const userTabs = document.getElementById('user-tabs');

    // 新規追加UI要素
    const autoModeToggle = document.getElementById('auto-mode-toggle');
    const btnPrevMonth = document.getElementById('btn-prev-month');
    const btnNextMonth = document.getElementById('btn-next-month');
    const calendarTitle = document.getElementById('calendar-title');
    const btnHolidayMode = document.getElementById('btn-holiday-mode');
    const calendarBody = document.getElementById('calendar-body');
    const btnThemeToggle = document.getElementById('btn-theme-toggle');

    // 会社休日UI要素
    const btnCompanyHoliday = document.getElementById('btn-company-holiday');
    const companyHolidayModal = document.getElementById('company-holiday-modal');
    const btnCloseCompanyModal = document.getElementById('btn-close-company-modal');
    const companyHolidayStart = document.getElementById('company-holiday-start');
    const companyHolidayEnd = document.getElementById('company-holiday-end');
    const btnSaveCompanyHoliday = document.getElementById('btn-save-company-holiday');

    // モーダルUI要素
    const editModal = document.getElementById('edit-modal');
    const modalDateTitle = document.getElementById('modal-date-title');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const modalRecordsList = document.getElementById('modal-records-list');
    const formUser = document.getElementById('form-user');
    const formType = document.getElementById('form-type');
    const formTime = document.getElementById('form-time');
    const formRowNum = document.getElementById('form-row-num');
    const btnSaveRecord = document.getElementById('btn-save-record');
    const formActionTitle = document.getElementById('form-action-title');

    // 状態管理
    let pendingStatus = '';
    let isHolidayMode = false;
    let currentCalDate = new Date(); // カレンダーの表示月
    let stampRecords = []; // GASから取得した全打刻データ
    let activeUser = '横澤'; // 現在選択されているユーザー名

    // 日本の祝日判定用キャッシュ
    let holidaysCache = {};

    // 1. 初期化処理
    init();

    async function init() {
        // テーマ切り替え初期化
        const currentTheme = localStorage.getItem('theme') || 'dark';
        if (currentTheme === 'light') {
            document.body.classList.add('light-mode');
            btnThemeToggle.textContent = '🌙';
        } else {
            document.body.classList.remove('light-mode');
            btnThemeToggle.textContent = '☀️';
        }

        btnThemeToggle.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
            const isLight = document.body.classList.contains('light-mode');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            btnThemeToggle.textContent = isLight ? '🌙' : '☀️';
        });

        // ラジオボタンの変更監視
        const userRadios = document.querySelectorAll('input[name="user"]');
        userRadios.forEach(radio => {
            if (radio.checked) activeUser = radio.value;
            radio.addEventListener('change', (e) => {
                activeUser = e.target.value;
                updateAutoModeToggleUI();
                renderCalendar();
            });
        });

        // オートモードの初期状態設定
        updateAutoModeToggleUI();

        // オートモードトグルの変更イベント
        autoModeToggle.addEventListener('change', (e) => {
            localStorage.setItem(`autoMode_${activeUser}`, e.target.checked);
        });

        // カレンダーの月移動イベント
        btnPrevMonth.addEventListener('click', () => {
            changeMonth(-1);
        });

        btnNextMonth.addEventListener('click', () => {
            changeMonth(1);
        });

        // 休日設定モードのトグル
        btnHolidayMode.addEventListener('click', () => {
            isHolidayMode = !isHolidayMode;
            if (isHolidayMode) {
                btnHolidayMode.classList.add('active');
            } else {
                btnHolidayMode.classList.remove('active');
            }
        });

        // 打刻ボタンイベント
        btnIn.addEventListener('click', () => showConfirmSection('出勤'));
        btnOut.addEventListener('click', () => showConfirmSection('退勤'));
        btnCancel.addEventListener('click', hideConfirmSection);
        btnConfirm.addEventListener('click', () => {
            sendData(pendingStatus, datetimeInput.value, 'stamp');
        });

        // モーダルクローズ
        btnCloseModal.addEventListener('click', closeModal);
        window.addEventListener('click', (e) => {
            if (e.target === editModal) closeModal();
            if (e.target === companyHolidayModal) companyHolidayModal.classList.add('hidden');
        });

        // 会社休日モーダルを開く
        btnCompanyHoliday.addEventListener('click', () => {
            const today = formatDateKey(new Date());
            companyHolidayStart.value = today;
            companyHolidayEnd.value = today;
            companyHolidayModal.classList.remove('hidden');
        });

        // 会社休日モーダルを閉じる
        btnCloseCompanyModal.addEventListener('click', () => {
            companyHolidayModal.classList.add('hidden');
        });

        // 会社休日の一括保存
        btnSaveCompanyHoliday.addEventListener('click', saveCompanyHolidays);

        // レコード保存ボタン
        btnSaveRecord.addEventListener('click', saveRecordFromModal);

        // データの取得とカレンダーの初期描画
        await fetchRecords();
        
        // オートモード自動打刻チェックの実行
        checkAndRunAutoMode();

        // 1分ごとに自動打刻と打刻データを同期・チェック（画面を開きっぱなしの時のリアルタイム対応）
        setInterval(async () => {
            await fetchRecords();
            checkAndRunAutoMode();
        }, 60000);

        // スワイプによるカレンダー月移動（スマホ対応）
        let touchStartX = 0;
        let touchStartY = 0;
        const calendarContainer = document.querySelector('.calendar-container');

        calendarContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        calendarContainer.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].screenX;
            const touchEndY = e.changedTouches[0].screenY;
            
            const diffX = touchEndX - touchStartX;
            const diffY = touchEndY - touchStartY;

            // 左右のスワイプ量が60px以上、かつ上下のスクロール量より左右の移動量が大きい場合のみ実行
            if (Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY)) {
                if (diffX > 0) {
                    // 右スワイプ -> 前月へ
                    changeMonth(-1);
                } else {
                    // 左スワイプ -> 翌月へ
                    changeMonth(1);
                }
            }
        }, { passive: true });
    }

    // ユーザー選択に合わせたオートモードトグルUIの同期
    function updateAutoModeToggleUI() {
        const isAuto = localStorage.getItem(`autoMode_${activeUser}`) === 'true';
        autoModeToggle.checked = isAuto;
    }

    // 日本の祝日判定ロジックの実装
    function getJapaneseHolidays(year) {
        if (holidaysCache[year]) return holidaysCache[year];

        const holidays = {};
        const add = (dateStr, name) => { holidays[dateStr] = name; };

        // 固定祝日
        add(`${year}-01-01`, "元日");
        add(`${year}-02-11`, "建国記念の日");
        add(`${year}-02-23`, "天皇誕生日");
        add(`${year}-04-29`, "昭和の日");
        add(`${year}-05-03`, "憲法記念日");
        add(`${year}-05-04`, "みどりの日");
        add(`${year}-05-05`, "こどもの日");
        add(`${year}-08-11`, "山の日");
        add(`${year}-11-03`, "文化の日");
        add(`${year}-11-23`, "勤労感謝の日");

        // ハッピーマンデー (第N月曜日)
        const getHappyMonday = (month, weekNum) => {
            let count = 0;
            for (let day = 1; day <= 31; day++) {
                const date = new Date(year, month - 1, day);
                if (date.getDay() === 1) { // 月曜日
                    count++;
                    if (count === weekNum) {
                        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    }
                }
            }
            return null;
        };

        const seijin = getHappyMonday(1, 2);
        if (seijin) add(seijin, "成人の日");

        const umi = getHappyMonday(7, 3);
        if (umi) add(umi, "海の日");

        const keiro = getHappyMonday(9, 3);
        if (keiro) add(keiro, "敬老の日");

        const sports = getHappyMonday(10, 2);
        if (sports) add(sports, "スポーツの日");

        // 春分の日 (簡易計算)
        let springDay = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        add(`${year}-03-${String(springDay).padStart(2, '0')}`, "春分の日");

        // 秋分の日 (簡易計算)
        let autumnDay = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        add(`${year}-09-${String(autumnDay).padStart(2, '0')}`, "秋分の日");

        // 振替休日
        const holidayDates = Object.keys(holidays).sort();
        holidayDates.forEach(dateStr => {
            const date = new Date(dateStr);
            if (date.getDay() === 0) { // 日曜日
                let target = new Date(date);
                while (true) {
                    target.setDate(target.getDate() + 1);
                    const targetStr = formatDateKey(target);
                    if (!holidays[targetStr]) {
                        add(targetStr, "振替休日");
                        break;
                    }
                }
            }
        });

        // 国民の休日
        for (let month = 1; month <= 12; month++) {
            for (let day = 2; day <= 30; day++) {
                const currentStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const date = new Date(year, month - 1, day);
                if (date.getDay() !== 0 && !holidays[currentStr]) {
                    const prev = new Date(date);
                    prev.setDate(prev.getDate() - 1);
                    const next = new Date(date);
                    next.setDate(next.getDate() + 1);
                    if (holidays[formatDateKey(prev)] && holidays[formatDateKey(next)] && 
                        holidays[formatDateKey(prev)] !== "振替休日" && holidays[formatDateKey(next)] !== "振替休日") {
                        add(currentStr, "国民の休日");
                    }
                }
            }
        }

        holidaysCache[year] = holidays;
        return holidays;
    }

    function formatDateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // 月移動アニメーション制御 (スワイプ方向に対応)
    function changeMonth(direction) {
        // スライドアウトクラスを適用
        if (direction === 1) {
            calendarBody.classList.add('slide-out-left');
        } else {
            calendarBody.classList.add('slide-out-right');
        }

        // アニメーション進行中に描画を更新し、逆方向からスライドイン
        setTimeout(() => {
            currentCalDate.setMonth(currentCalDate.getMonth() + direction);
            renderCalendar();

            calendarBody.classList.remove('slide-out-left', 'slide-out-right');
            if (direction === 1) {
                calendarBody.classList.add('slide-in-right');
            } else {
                calendarBody.classList.add('slide-in-left');
            }

            // アニメーション完了後にクラスをクリア
            setTimeout(() => {
                calendarBody.classList.remove('slide-in-left', 'slide-in-right');
            }, 250);
        }, 150);
    }

    // 2. GASからのデータ取得
    async function fetchRecords() {
        try {
            // キャッシュ破棄用のタイムスタンプをパラメータに付与
            const response = await fetch(`${GAS_URL}?t=${new Date().getTime()}`);
            if (!response.ok) throw new Error('ネットワークエラー');
            stampRecords = await response.json();
            renderCalendar();
        } catch (error) {
            console.error('データ取得失敗:', error);
            showStatusMessage('❌ データの取得に失敗しました。再読み込みしてください。', '#ef4444');
        }
    }

    // 3. カレンダーの描画処理
    function renderCalendar() {
        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth(); // 0-11
        
        calendarTitle.textContent = `${year}年 ${month + 1}月`;
        calendarBody.innerHTML = '';

        const holidays = getJapaneseHolidays(year);
        const todayStr = formatDateKey(new Date());

        // 月の最初の日と総日数
        const firstDayIndex = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();

        // 前月の空枠
        for (let i = 0; i < firstDayIndex; i++) {
            const emptyCell = document.createElement('div');
            emptyCell.classList.add('calendar-day', 'empty');
            calendarBody.appendChild(emptyCell);
        }

        // 当月の日付マス生成
        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(year, month, day);
            const dateStr = formatDateKey(date);
            
            const cell = document.createElement('div');
            cell.classList.add('calendar-day');

            // 今日の日付ならクラスを付与
            if (dateStr === todayStr) {
                cell.classList.add('today');
            }

            // 曜日・祝日判定
            const dayOfWeek = date.getDay();
            if (dayOfWeek === 0) cell.classList.add('sunday');
            if (dayOfWeek === 6) cell.classList.add('saturday');
            
            if (holidays[dateStr]) {
                cell.classList.add('holiday-day');
                cell.title = holidays[dateStr];
            }

            // 日付表示
            const numLabel = document.createElement('div');
            numLabel.classList.add('day-number');
            numLabel.textContent = day;
            cell.appendChild(numLabel);

            // この日付の打刻データをフィルタリング
            const dayRecords = stampRecords.filter(r => r.datetime && r.datetime.startsWith(dateStr));
            
            const bandList = document.createElement('div');
            bandList.classList.add('day-band-list');

            // 帯の表示判定 (表示順：会社休日、個別休日、横澤出勤、横澤退勤, 鈴木出勤, 鈴木退勤)
            const companyHoliday = dayRecords.find(r => r.name === '会社' && r.status === '休日');
            const yokozawaHoliday = dayRecords.find(r => r.name === '横澤' && r.status === '休日');
            const suzukiHoliday = dayRecords.find(r => r.name === '鈴木' && r.status === '休日');

            // 0. 会社全体休日 (最上部に赤い帯で「休日」と表示)
            if (companyHoliday) {
                const b = document.createElement('div');
                b.classList.add('day-band', 'band-company-holiday');
                b.textContent = '休日';
                b.title = '会社休日';
                bandList.appendChild(b);
            }

            const yokozawaIn = dayRecords.find(r => r.name === '横澤' && r.status === '出勤');
            const yokozawaOut = dayRecords.find(r => r.name === '横澤' && r.status === '退勤');
            const suzukiIn = dayRecords.find(r => r.name === '鈴木' && r.status === '出勤');
            const suzukiOut = dayRecords.find(r => r.name === '鈴木' && r.status === '退勤');

            // 1. 手動の休日 (横澤: 赤, 鈴木: オレンジ、名前のみ表示)
            if (yokozawaHoliday) {
                const b = document.createElement('div');
                b.classList.add('day-band', 'band-yokozawa-holiday');
                b.textContent = '横澤';
                b.title = '横澤 休日';
                bandList.appendChild(b);
            }
            if (suzukiHoliday) {
                const b = document.createElement('div');
                b.classList.add('day-band', 'band-suzuki-holiday');
                b.textContent = '鈴木';
                b.title = '鈴木 休日';
                bandList.appendChild(b);
            }

            // 2. 横澤 出勤 (文字なし)
            if (yokozawaIn) {
                const b = document.createElement('div');
                b.classList.add('day-band', 'band-yokozawa');
                b.title = `横澤 出勤 ${formatTime(yokozawaIn.datetime)}`;
                bandList.appendChild(b);
            }
            // 3. 横澤 退勤 (文字なし)
            if (yokozawaOut) {
                const b = document.createElement('div');
                b.classList.add('day-band', 'band-yokozawa');
                b.title = `横澤 退勤 ${formatTime(yokozawaOut.datetime)}`;
                bandList.appendChild(b);
            }
            // 4. 鈴木 出勤 (文字なし)
            if (suzukiIn) {
                const b = document.createElement('div');
                b.classList.add('day-band', 'band-suzuki');
                b.title = `鈴木 出勤 ${formatTime(suzukiIn.datetime)}`;
                bandList.appendChild(b);
            }
            // 5. 鈴木 退勤 (文字なし)
            if (suzukiOut) {
                const b = document.createElement('div');
                b.classList.add('day-band', 'band-suzuki');
                b.title = `鈴木 退勤 ${formatTime(suzukiOut.datetime)}`;
                bandList.appendChild(b);
            }

            cell.appendChild(bandList);

            // クリックイベント
            cell.addEventListener('click', () => handleDayClick(dateStr, dayRecords));

            calendarBody.appendChild(cell);
        }
    }

    // 日時文字列から HH:mm を抽出
    function formatTime(datetimeStr) {
        if (!datetimeStr || datetimeStr.length < 16) return '';
        // YYYY-MM-DD HH:mm:ss または YYYY-MM-DDTHH:mm 形式
        const parts = datetimeStr.split(/[ T]/);
        if (parts.length > 1) {
            return parts[1].substring(0, 5);
        }
        return '';
    }

    // 日付セルクリック時の処理
    async function handleDayClick(dateStr, dayRecords) {
        if (isHolidayMode) {
            // 休日トグル処理
            const existingHoliday = dayRecords.find(r => r.name === activeUser && r.status === '休日');
            
            if (existingHoliday) {
                // 既に休日なら削除
                showStatusMessage(`${activeUser}の休日設定を解除中...`, '#fff');
                await deleteRecord(existingHoliday.rowNum);
            } else {
                // 休日でなければ登録 (日付のみ送信)
                showStatusMessage(`${activeUser}の休日を設定中...`, '#fff');
                await sendData('休日', dateStr, 'stamp');
            }
        } else {
            // 編集・詳細ポップアップを開く
            openEditModal(dateStr, dayRecords);
        }
    }

    // 4. 既存打刻送信画面の制御
    function showConfirmSection(status) {
        pendingStatus = status;
        confirmText.textContent = `${activeUser}さんの「${status}」この時間でよろしいですか？`;

        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        datetimeInput.value = now.toISOString().slice(0, 16);

        actionButtons.classList.add('hidden');
        userTabs.classList.add('hidden');
        confirmSection.classList.remove('hidden');
        statusMessage.textContent = '';
    }

    function hideConfirmSection() {
        confirmSection.classList.add('hidden');
        actionButtons.classList.remove('hidden');
        userTabs.classList.remove('hidden');
    }

    // 5. データ送信 (GASへのPOST)
    async function sendData(status, datetimeString, action = 'stamp', rowNum = null, isAuto = false) {
        const formattedDate = datetimeString.replace('T', ' ').replace(/-/g, '/');
        
        if (!isAuto) {
            hideConfirmSection();
            showStatusMessage(`${activeUser}の${status}を記録中...`, '#fff');
            setButtonsDisabled(true);
        }

        const formData = new URLSearchParams();
        formData.append('action', action);
        formData.append('name', activeUser);
        formData.append('status', status);
        formData.append('datetime', datetimeString);
        if (rowNum) formData.append('rowNum', rowNum);

        try {
            const response = await fetch(GAS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            });

            const result = await response.json();

            if (result.status === 'success') {
                const msg = isAuto 
                    ? `🤖 オートモード: ${activeUser}の${status}を自動打刻しました。\n（時間：${formattedDate}）`
                    : `✅ ${activeUser}の${status}を記録しました！\n（時間：${formattedDate}）`;
                
                showStatusMessage(msg, '#4cd964');
                await fetchRecords(); // カレンダー再描画と同期
            } else {
                throw new Error(result.message || 'サーバーエラー');
            }

        } catch (error) {
            console.error('Error:', error);
            showStatusMessage('❌ 送信に失敗しました。スプレッドシートを確認してください。', '#ef4444');
        } finally {
            if (!isAuto) {
                setButtonsDisabled(false);
                setTimeout(() => {
                    statusMessage.textContent = '';
                }, 5000);
            }
        }
    }

    // 行番号によるレコード削除処理
    async function deleteRecord(rowNum) {
        showStatusMessage('データを削除中...', '#fff');
        setButtonsDisabled(true);

        const formData = new URLSearchParams();
        formData.append('action', 'delete');
        formData.append('rowNum', rowNum);

        try {
            const response = await fetch(GAS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            });

            const result = await response.json();

            if (result.status === 'success') {
                showStatusMessage('✅ データを削除しました。', '#4cd964');
                await fetchRecords();
            } else {
                throw new Error(result.message || '削除失敗');
            }
        } catch (error) {
            console.error('Delete Error:', error);
            showStatusMessage('❌ 削除に失敗しました。', '#ef4444');
        } finally {
            setButtonsDisabled(false);
            setTimeout(() => { statusMessage.textContent = ''; }, 3000);
        }
    }

    // ボタンの非活性制御
    function setButtonsDisabled(disabled) {
        btnIn.disabled = disabled;
        btnOut.disabled = disabled;
        btnConfirm.disabled = disabled;
        btnCancel.disabled = disabled;
        btnHolidayMode.disabled = disabled;
    }

    // ステータスメッセージの表示
    function showStatusMessage(text, color) {
        statusMessage.textContent = text;
        statusMessage.style.color = color;
    }

    // 6. モーダル画面の処理
    let selectedModalDate = '';

    function openEditModal(dateStr, dayRecords) {
        selectedModalDate = dateStr;
        modalDateTitle.textContent = `${dateStr.replace(/-/g, '/')} の打刻情報`;
        
        // フォームリセット (追加モード)
        resetModalForm();

        // 打刻リストの構築
        modalRecordsList.innerHTML = '';
        if (dayRecords.length === 0) {
            modalRecordsList.innerHTML = '<p style="color:#666; font-style:italic; text-align:center;">打刻データはありません。</p>';
        } else {
            dayRecords.forEach(record => {
                const item = document.createElement('div');
                item.classList.add('modal-record-item');

                const timeStr = record.status === '休日' ? '終日' : formatTime(record.datetime);
                item.innerHTML = `
                    <div class="record-info">
                        ${record.name} - <span style="color: ${record.status === '出勤' ? '#0284c7' : record.status === '退勤' ? '#dc2626' : '#64748b'}">${record.status}</span> (${timeStr})
                    </div>
                    <div class="record-actions">
                        <button class="record-btn edit" data-rownum="${record.rowNum}" data-name="${record.name}" data-status="${record.status}" data-datetime="${record.datetime}">編集</button>
                        <button class="record-btn delete" data-rownum="${record.rowNum}">削除</button>
                    </div>
                `;
                modalRecordsList.appendChild(item);
            });

            // 編集・削除ボタンにイベント登録
            modalRecordsList.querySelectorAll('.record-btn.edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const row = e.target.dataset.rownum;
                    const name = e.target.dataset.name;
                    const status = e.target.dataset.status;
                    const datetime = e.target.dataset.datetime;
                    setupFormForEdit(row, name, status, datetime);
                });
            });

            modalRecordsList.querySelectorAll('.record-btn.delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const row = e.target.dataset.rownum;
                    if (confirm('この打刻データを削除してもよろしいですか？')) {
                        closeModal();
                        await deleteRecord(row);
                    }
                });
            });
        }

        editModal.classList.remove('hidden');
    }

    function closeModal() {
        editModal.classList.add('hidden');
    }

    function resetModalForm() {
        formActionTitle.textContent = '打刻の追加';
        formUser.value = activeUser;
        formType.value = '出勤';
        formTime.value = '09:00';
        formRowNum.value = '';
    }

    function setupFormForEdit(rowNum, name, status, datetime) {
        formActionTitle.textContent = '打刻の編集';
        formUser.value = name;
        formType.value = status;
        formRowNum.value = rowNum;
        
        if (status === '休日') {
            formTime.value = '';
            formTime.disabled = true;
        } else {
            formTime.disabled = false;
            formTime.value = formatTime(datetime);
        }
    }

    // モーダルでのタイプ切り替え時の時間フォーム無効化制御
    formType.addEventListener('change', (e) => {
        if (e.target.value === '休日') {
            formTime.value = '';
            formTime.disabled = true;
        } else {
            formTime.disabled = false;
            if (!formTime.value) formTime.value = '09:00';
        }
    });

    // モーダルからの保存処理
    async function saveRecordFromModal() {
        const name = formUser.value;
        const status = formType.value;
        const time = formTime.value;
        const rowNum = formRowNum.value;

        if (status !== '休日' && !time) {
            alert('時間を指定してください。');
            return;
        }

        let datetimeVal = '';
        if (status === '休日') {
            datetimeVal = selectedModalDate; // 休日なら日付のみ
        } else {
            datetimeVal = `${selectedModalDate}T${time}`; // 日付T時間
        }

        closeModal();

        // GASへの送信処理
        if (rowNum) {
            // 編集（update）
            showStatusMessage('打刻データを修正中...', '#fff');
            setButtonsDisabled(true);
            const formData = new URLSearchParams();
            formData.append('action', 'update');
            formData.append('rowNum', rowNum);
            formData.append('name', name);
            formData.append('status', status);
            formData.append('datetime', datetimeVal);

            try {
                const response = await fetch(GAS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData
                });
                const result = await response.json();
                if (result.status === 'success') {
                    showStatusMessage('✅ 打刻データを修正しました。', '#4cd964');
                    await fetchRecords();
                } else {
                    throw new Error(result.message || '修正失敗');
                }
            } catch (error) {
                console.error('Update Error:', error);
                showStatusMessage('❌ 修正に失敗しました。', '#ef4444');
            } finally {
                setButtonsDisabled(false);
                setTimeout(() => { statusMessage.textContent = ''; }, 3000);
            }
        } else {
            // 新規追加 (stamp)
            // 送信時の activeUser を一時変更して送信
            const prevUser = activeUser;
            activeUser = name;
            await sendData(status, datetimeVal, 'stamp');
            activeUser = prevUser;
        }
    }

    // 会社休日の期間一括保存処理
    async function saveCompanyHolidays() {
        const startVal = companyHolidayStart.value;
        const endVal = companyHolidayEnd.value;

        if (!startVal || !endVal) {
            alert('開始日と終了日を指定してください。');
            return;
        }

        const start = new Date(startVal);
        const end = new Date(endVal);

        if (start > end) {
            alert('開始日は終了日より前の日付を指定してください。');
            return;
        }

        companyHolidayModal.classList.add('hidden');
        showStatusMessage('会社休日を登録中...', '#fff');
        setButtonsDisabled(true);

        // 期間内の日付リストを生成
        const dateList = [];
        let current = new Date(start);
        while (current <= end) {
            dateList.push(formatDateKey(current));
            current.setDate(current.getDate() + 1);
        }

        // 順次送信
        let successCount = 0;
        const prevUser = activeUser;
        activeUser = '会社';

        try {
            for (let i = 0; i < dateList.length; i++) {
                const dateStr = dateList[i];
                showStatusMessage(`会社休日を登録中... (${i + 1}/${dateList.length}日)`, '#fff');
                
                const formData = new URLSearchParams();
                formData.append('action', 'stamp');
                formData.append('name', '会社');
                formData.append('status', '休日');
                formData.append('datetime', dateStr);

                const response = await fetch(GAS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData
                });
                const result = await response.json();
                if (result.status === 'success') {
                    successCount++;
                }
            }

            if (successCount === dateList.length) {
                showStatusMessage(`✅ 会社休日を登録しました！ (${successCount}日間)`, '#4cd964');
            } else {
                showStatusMessage(`⚠️ 一部登録に失敗しました。 (${successCount}/${dateList.length}日完了)`, '#fde047');
            }
            await fetchRecords();

        } catch (error) {
            console.error('Company Holiday Error:', error);
            showStatusMessage('❌ 会社休日の登録に失敗しました。', '#ef4444');
        } finally {
            activeUser = prevUser;
            setButtonsDisabled(false);
            setTimeout(() => { statusMessage.textContent = ''; }, 5000);
        }
    }

    // 7. オートモード自動打刻ロジック
    function getOrGenerateAutoTime(name, dateStr) {
        const key = `autoTime_${name}_${dateStr}`;
        let saved = localStorage.getItem(key);
        if (saved) return JSON.parse(saved);

        // 出勤 6:50 +- 5分 -> 6:45 から 6:55
        const inMin = Math.floor(Math.random() * 11) - 5;
        const inTimeDate = new Date();
        inTimeDate.setHours(6, 50 + inMin, 0);
        const inTimeStr = `${String(inTimeDate.getHours()).padStart(2, '0')}:${String(inTimeDate.getMinutes()).padStart(2, '0')}`;

        // 退勤 17:30 +- 5分 -> 17:25 から 17:35
        const outMin = Math.floor(Math.random() * 11) - 5;
        const outTimeDate = new Date();
        outTimeDate.setHours(17, 30 + outMin, 0);
        const outTimeStr = `${String(outTimeDate.getHours()).padStart(2, '0')}:${String(outTimeDate.getMinutes()).padStart(2, '0')}`;

        const val = { in: inTimeStr, out: outTimeStr };
        localStorage.setItem(key, JSON.stringify(val));
        return val;
    }

    async function checkAndRunAutoMode() {
        const now = new Date();
        const currentHour = now.getHours();

        // 午前7:00前は自動打刻を行わない（深夜0:00から朝7:00までの起動時はスキップ）
        if (currentHour < 7) return;

        const todayStr = formatDateKey(now);
        const currentYear = now.getFullYear();
        const currentMin = now.getMinutes();
        const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;

        // 日曜日は除外
        const dayOfWeek = now.getDay();
        if (dayOfWeek === 0) return;

        // 日本の祝日は除外
        const holidays = getJapaneseHolidays(currentYear);
        if (holidays[todayStr]) return;

        // 会社休日は除外
        const hasCompanyHoliday = stampRecords.some(r => r.name === '会社' && r.status === '休日' && r.datetime && r.datetime.startsWith(todayStr));
        if (hasCompanyHoliday) return;

        const users = ['横澤', '鈴木'];

        for (const user of users) {
            // オートモードがオンになっているか
            const isAuto = localStorage.getItem(`autoMode_${user}`) === 'true';
            if (!isAuto) continue;

            // 今日のそのユーザーの打刻状況を取得
            const dayRecords = stampRecords.filter(r => r.name === user && r.datetime && r.datetime.startsWith(todayStr));
            
            // 手動休日が設定されている場合は除外
            const hasHoliday = dayRecords.some(r => r.status === '休日');
            if (hasHoliday) continue;

            const hasIn = dayRecords.some(r => r.status === '出勤');
            const hasOut = dayRecords.some(r => r.status === '退勤');

            // 今日生成されたランダム出退勤時間を取得
            const autoTime = getOrGenerateAutoTime(user, todayStr);

            // 出勤の自動打刻 (午前7:00以降であれば即時打刻)
            if (!hasIn) {
                const doneKey = `autoDone_${user}_${todayStr}_出勤`;
                if (!localStorage.getItem(doneKey)) {
                    localStorage.setItem(doneKey, 'true');
                    // activeUserを切り替えて自動打刻送信
                    const prevUser = activeUser;
                    activeUser = user;
                    await sendData('出勤', `${todayStr}T${autoTime.in}`, 'stamp', null, true);
                    activeUser = prevUser;
                }
            }

            // 退勤の自動打刻 (午前7:00以降であれば即時打刻)
            if (!hasOut) {
                const doneKey = `autoDone_${user}_${todayStr}_退勤`;
                if (!localStorage.getItem(doneKey)) {
                    localStorage.setItem(doneKey, 'true');
                    const prevUser = activeUser;
                    activeUser = user;
                    await sendData('退勤', `${todayStr}T${autoTime.out}`, 'stamp', null, true);
                    activeUser = prevUser;
                }
            }
        }
    }
});
