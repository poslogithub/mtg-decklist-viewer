function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCardImage(cardName, setCode = null, cardNo = null) {
    try {
        let imageUrl;
        let searchName = cardName;
        let response;
        let data;
        const isEnglishCard = /^[0-9a-zA-Z]/.test(cardName);    // カード名の先頭が数字かアルファベットならば英語と判断

        // 分割カードの場合、`//`の左側のみを使用
        cardName = cardName.replace(/(?<!\s\/\/\s)\/(?!\/\s)/g, " // ");
        if (cardName.includes(" // ")) {
            searchName = cardName.split(" // ")[0].trim(); // 左側（第1面）を取得
        }

        // setCode と cardNo が提供された場合、コレクター番号で直接検索
        if (setCode && cardNo) {
            const baseUrl = `https://api.scryfall.com/cards/${setCode.toLowerCase()}/${cardNo}`;
            const url = isEnglishCard ? baseUrl : `${baseUrl}/ja`;
            response = await fetch(url);
            data = await response.json();

            // 日本語版カードが見つからなかった場合は、英語版カードを検索
            if (!isEnglishCard && data.object != "card") {
                response = await fetch(baseUrl);
                data = await response.json();
            }
            // 通常のカードの場合
            imageUrl = data.image_uris?.png;
            if (!imageUrl && data.card_faces) {
                // 両面カードの場合、表面の画像を取得
                imageUrl = data.card_faces[0].image_uris?.png;
            }
            if (imageUrl) {
                const imageResponse = await fetch(imageUrl);
                const imageBlob = await imageResponse.blob();
                return {
                    imageUrl: URL.createObjectURL(imageBlob),
                    manaCost: data.cmc || 0, // マナコスト
                    isCreature: data.type_line.includes("Creature"), // クリーチャーか否か
                    isLand: data.type_line.includes("Land") // 土地か否か
                };
            }
            // throw new Error(`「${cardName} (${setCode} #${cardNo})」のカード画像が見つかりませんでした`);
        }

        // setCode/cardNoがない場合、または失敗した場合、カード名で検索（フォールバック）
        const baseUrl = `https://api.scryfall.com/cards/search?q=name:"${encodeURIComponent(isEnglishCard ? cardName : searchName)}"`;
        const url = isEnglishCard ? baseUrl : `${baseUrl}+lang:japanese`;
        response = await fetch(url);
        data = await response.json();

        if (data.object == "list" && data.data.length > 0) {
            // カード名の一致を確認
            const exactMatch = data.data.find(card => 
                (isEnglishCard ? cardName : searchName) == (isEnglishCard ? card.name : card.printed_name)
            );
            
            if (exactMatch) {
                // 通常のカードの場合
                imageUrl = exactMatch.image_uris?.png;
                if (imageUrl) {
                    const imageResponse = await fetch(imageUrl);
                    const imageBlob = await imageResponse.blob();
                    return {
                        imageUrl: URL.createObjectURL(imageBlob),
                        manaCost: exactMatch.cmc || 0,
                        isCreature: exactMatch.type_line.includes("Creature"),
                        isLand: exactMatch.type_line.includes("Land")
                    };
                }
                return null;
            } else {
                const faceMatch = data.data.find(card => 
                    card.card_faces && searchName == (isEnglishCard ? card.card_faces[0].name : card.card_faces[0].printed_name)
                );
                // 両面カードor分割カード
                if (faceMatch) {
                    imageUrl = faceMatch.card_faces[0].image_uris?.png;
                    if (imageUrl) {
                        // 両面カードの表面
                        const imageResponse = await fetch(imageUrl);
                        const imageBlob = await imageResponse.blob();
                        return {
                            imageUrl: URL.createObjectURL(imageBlob),
                            manaCost: faceMatch.cmc || 0,
                            isCreature: faceMatch.type_line.includes("Creature"),
                            isLand: faceMatch.type_line.includes("Land")
                        };
                    } else {
                        imageUrl = faceMatch.image_uris?.png;
                        if (imageUrl) {
                            // 分割カードの第1面
                            const imageResponse = await fetch(imageUrl);
                            const imageBlob = await imageResponse.blob();
                            return {
                                imageUrl: URL.createObjectURL(imageBlob),
                                manaCost: faceMatch.cmc || 0,
                                isCreature: faceMatch.type_line.includes("Creature"),
                                isLand: faceMatch.type_line.includes("Land")
                            };
                        }
                    }
                }
            }
        }
        throw new Error(`「${cardName}」のカード画像が見つかりませんでした`);
    } catch (error) {
        console.error(error);
        return null;
    }
}

async function downloadSection(sectionId, fileName) {
    const section = document.getElementById(sectionId);
    try {
        // セクションの幅と高さを計算
        const cardWidth = 223; // カード1枚の幅
        const cardHeight = 310; // カード1枚の高さ
        const gap = 10; // カード間の隙間
        const columnGap = 20; // non-landsとlandsの間の隙間
        const rowGap = 20; // クリーチャー行と非クリーチャー行の間の隙間
        const headerHeight = 50; // ヘッダーの高さ（見出しや余白）
        const extraBottomPadding = 20;

        // マナカーブ表示の場合、幅と高さを動的に計算
        let totalWidth = 0;
        let totalHeight = 0;

        if (sectionId === 'deckSectionManaCurve') {
            const nonLands = section.querySelector('.non-lands');
            const landsColumn = section.querySelector('.lands-column');
            const creaturesRow = nonLands.querySelector('.creatures-row');
            const nonCreaturesRow = nonLands.querySelector('.non-creatures-row');

            // 列の数（1以下, 2, 3, 4, 5, 6以上 の6列 + 土地列）
            const numColumns = 7; // 6（マナコスト）+ 1（土地）
            totalWidth = numColumns * cardWidth + (numColumns - 1) * gap + columnGap;

            // 現在の重ね幅を取得
            const overlapOffset = parseInt(getComputedStyle(section.querySelector('.mana-section')).getPropertyValue('--overlap-offset')) || -272;
            const overlapHeight = overlapOffset + cardHeight; // 重なる部分の高さ（正の値）

            const creaturesHeight = creaturesRow ? Array.from(creaturesRow.querySelectorAll('.mana-column')).reduce((maxHeight, column) => {
                const cards = column.querySelectorAll('.card-container').length;
                return Math.max(maxHeight, cards > 0 ? cardHeight + (cards - 1) * overlapHeight : 0);
            }, 0) : 0;

            const nonCreaturesHeight = nonCreaturesRow ? Array.from(nonCreaturesRow.querySelectorAll('.mana-column')).reduce((maxHeight, column) => {
                const cards = column.querySelectorAll('.card-container').length;
                return Math.max(maxHeight, cards > 0 ? cardHeight + (cards - 1) * overlapHeight : 0);
            }, 0) : 0;

            const landsHeight = landsColumn ? landsColumn.querySelectorAll('.card-container').length > 0 ? cardHeight + (landsColumn.querySelectorAll('.card-container').length - 1) * overlapHeight : 0 : 0;

            // クリーチャー行と非クリーチャー行の高さを合計し、間の隙間とヘッダー分の余裕を追加
            totalHeight = creaturesHeight + nonCreaturesHeight + rowGap + headerHeight;
            totalHeight = Math.max(totalHeight, landsHeight + headerHeight); // 土地列の高さとも比較
            totalHeight += extraBottomPadding;
            totalHeight += 50; // なんか下端が切れるから追加の余白
        } else {
            // タイル表示の場合
            const cards = section.querySelectorAll('.card-container');
            const numCards = cards.length;
            const cardsPerRow = Math.floor((window.innerWidth - 20) / (cardWidth + gap)); // ビューポート幅での1行のカード数
            const numRows = Math.ceil(numCards / cardsPerRow);
            totalWidth = Math.min(numCards, cardsPerRow) * (cardWidth + gap);
            totalHeight = numRows * (cardHeight + gap) + headerHeight;
            totalHeight += extraBottomPadding; // 追加の余白（下端が切れないように）
        }

        // セクションのスタイルを一時的に変更してキャプチャ
        const originalWidth = section.style.width;
        const originalHeight = section.style.height;
        const originalOverflow = section.style.overflow;

        section.style.width = `${totalWidth}px`;
        section.style.height = `${totalHeight}px`;
        section.style.overflow = 'visible';

        const canvas = await html2canvas(section, {
            backgroundColor: '#ffffff',
            scale: 1,
            useCORS: true,
            width: totalWidth,
            height: totalHeight,
            scrollX: 0,
            scrollY: -window.scrollY,
        });

        // スタイルを元に戻す
        section.style.width = originalWidth;
        section.style.height = originalHeight;
        section.style.overflow = originalOverflow;

        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = fileName;
        link.click();
    } catch (error) {
        console.error('画像のダウンロードに失敗しました:', error);
        alert('画像のダウンロードに失敗しました。カード画像が正しく読み込まれていない可能性があります。');
    }
}

async function downloadAll() {
    const deckContainer = document.getElementById('deckContainer');
    const deckSection = document.getElementById('deckSection');
    const sideboardSection = document.getElementById('sideboardSection');
    const deckSectionManaCurve = document.getElementById('deckSectionManaCurve');

    try {
        // 現在の表示モードを取得
        const displayMode = document.querySelector('input[name="displayMode"]:checked').value;

        // 現在の表示状態を保存
        const originalDeckDisplay = deckSection.style.display;
        const originalSideboardDisplay = sideboardSection.style.display;
        const originalManaCurveDisplay = deckSectionManaCurve.style.display;

        // コンテナの幅と高さを計算
        const cardWidth = 223; // カード1枚の幅
        const cardHeight = 310; // カード1枚の高さ
        const overlapHeight = cardHeight / 8; // 重ねる部分（カード高さの1/8）
        const gap = 10; // カード間の隙間
        const columnGap = 20; // non-landsとlandsの間の隙間
        const rowGap = 20; // クリーチャー行と非クリーチャー行の間の隙間
        const sectionGap = 20; // メインデッキとサイドボードの間の隙間
        const headerHeight = 50; // ヘッダーの高さ（見出しや余白）
        const extraBottomPadding = 20; // 下部に追加する余白

        let totalWidth = 0;
        let totalHeight = 0;

        if (displayMode === "manaCurve") {
            // マナカーブ表示モードの場合
            deckSection.style.display = "none";
            deckSectionManaCurve.style.display = deckSectionManaCurve.querySelector("#deckImagesManaCurve").children.length > 0 ? "block" : "none";
            sideboardSection.style.display = sideboardSection.querySelector("#sideboardImages").children.length > 0 ? "block" : "none";

            // マナカーブ表示の幅と高さを計算
            if (deckSectionManaCurve.querySelector("#deckImagesManaCurve").children.length > 0) {
                const nonLands = deckSectionManaCurve.querySelector('.non-lands');
                const landsColumn = deckSectionManaCurve.querySelector('.lands-column');
                const creaturesRow = nonLands.querySelector('.creatures-row');
                const nonCreaturesRow = nonLands.querySelector('.non-creatures-row');

                const numColumns = 7; // 6（マナコスト）+ 1（土地）
                totalWidth = numColumns * cardWidth + (numColumns - 1) * gap + columnGap;

                const overlapOffset = parseInt(getComputedStyle(deckSectionManaCurve.querySelector('.mana-section')).getPropertyValue('--overlap-offset')) || -272;
                const overlapHeight = overlapOffset + cardHeight;

                const creaturesHeight = creaturesRow ? Array.from(creaturesRow.querySelectorAll('.mana-column')).reduce((maxHeight, column) => {
                    const cards = column.querySelectorAll('.card-container').length;
                    return Math.max(maxHeight, cards > 0 ? cardHeight + (cards - 1) * overlapHeight : 0);
                }, 0) : 0;
    
                const nonCreaturesHeight = nonCreaturesRow ? Array.from(nonCreaturesRow.querySelectorAll('.mana-column')).reduce((maxHeight, column) => {
                    const cards = column.querySelectorAll('.card-container').length;
                    return Math.max(maxHeight, cards > 0 ? cardHeight + (cards - 1) * overlapHeight : 0);
                }, 0) : 0;
    
                const landsHeight = landsColumn ? landsColumn.querySelectorAll('.card-container').length > 0 ? cardHeight + (landsColumn.querySelectorAll('.card-container').length - 1) * overlapHeight : 0 : 0;
    
                totalHeight = creaturesHeight + nonCreaturesHeight + rowGap + headerHeight;
                totalHeight = Math.max(totalHeight, landsHeight + headerHeight);
                totalHeight += extraBottomPadding; // 調整済みの余白を追加
            }

            // サイドボードの幅と高さを計算（タイル表示）
            if (sideboardSection.querySelector("#sideboardImages").children.length > 0) {
                const cards = sideboardSection.querySelectorAll('.card-container');
                const numCards = cards.length;
                const cardsPerRow = Math.floor(totalWidth / (cardWidth + gap)); // メインデッキの幅に合わせて計算
                const numRows = Math.ceil(numCards / cardsPerRow);
                const sideboardWidth = Math.min(numCards, cardsPerRow) * (cardWidth + gap);
                const sideboardHeight = numRows * (cardHeight + gap) + headerHeight;

                totalWidth = Math.max(totalWidth, sideboardWidth);
                totalHeight += sideboardHeight + sectionGap; // メインデッキとサイドボードの間の隙間
                totalHeight += extraBottomPadding; // 調整済みの余白を追加
                totalHeight += 30; // なんか下端が切れるから追加の余白
            }
        } else {
            // タイル表示モードの場合
            deckSection.style.display = deckSection.querySelector("#deckImages").children.length > 0 ? "block" : "none";
            sideboardSection.style.display = sideboardSection.querySelector("#sideboardImages").children.length > 0 ? "block" : "none";
            deckSectionManaCurve.style.display = "none";

            // メインデッキの幅と高さを計算（タイル表示）
            if (deckSection.querySelector("#deckImages").children.length > 0) {
                const cards = deckSection.querySelectorAll('.card-container');
                const numCards = cards.length;
                const cardsPerRow = Math.floor((window.innerWidth - 20) / (cardWidth + gap)); // ビューポート幅での1行のカード数
                const numRows = Math.ceil(numCards / cardsPerRow);
                totalWidth = Math.min(numCards, cardsPerRow) * (cardWidth + gap);
                totalHeight = numRows * (cardHeight + gap) + headerHeight;
                totalHeight += extraBottomPadding; // 調整済みの余白を追加
            }

            // サイドボードの幅と高さを計算（タイル表示）
            if (sideboardSection.querySelector("#sideboardImages").children.length > 0) {
                const cards = sideboardSection.querySelectorAll('.card-container');
                const numCards = cards.length;
                const cardsPerRow = Math.floor(totalWidth / (cardWidth + gap)); // メインデッキの幅に合わせて計算
                const numRows = Math.ceil(numCards / cardsPerRow);
                const sideboardWidth = Math.min(numCards, cardsPerRow) * (cardWidth + gap);
                const sideboardHeight = numRows * (cardHeight + gap) + headerHeight;

                totalWidth = Math.max(totalWidth, sideboardWidth);
                totalHeight += sideboardHeight + sectionGap; // メインデッキとサイドボードの間の隙間
                totalHeight += extraBottomPadding; // 調整済みの余白を追加
            }
        }

        // コンテナのスタイルを一時的に変更
        const originalWidth = deckContainer.style.width;
        const originalHeight = deckContainer.style.height;
        const originalOverflow = deckContainer.style.overflow;

        deckContainer.style.width = `${totalWidth}px`;
        deckContainer.style.height = `${totalHeight}px`;
        deckContainer.style.overflow = 'visible';

        const canvas = await html2canvas(deckContainer, {
            backgroundColor: '#ffffff', // bodyの背景色（白色）に合わせる
            scale: 1,
            useCORS: true,
            width: totalWidth,
            height: totalHeight,
            scrollX: 0,
            scrollY: -window.scrollY,
        });

        // スタイルを元に戻す
        deckContainer.style.width = originalWidth;
        deckContainer.style.height = originalHeight;
        deckContainer.style.overflow = originalOverflow;

        // 表示状態を元に戻す
        deckSection.style.display = originalDeckDisplay;
        sideboardSection.style.display = originalSideboardDisplay;
        deckSectionManaCurve.style.display = originalManaCurveDisplay;

        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'deck-all.png';
        link.click();
    } catch (error) {
        console.error('画像のダウンロードに失敗しました:', error);
        alert('画像のダウンロードに失敗しました。カード画像が正しく読み込まれていない可能性があります。');
    }
}

function toggleDisplayMode() {
    const displayMode = document.querySelector('input[name="displayMode"]:checked').value;
    const deckSection = document.getElementById("deckSection");
    const sideboardSection = document.getElementById("sideboardSection");
    const deckSectionManaCurve = document.getElementById("deckSectionManaCurve");
    const overlapControl = document.querySelector('.overlap-control');

    if (displayMode === "tile") {
        deckSection.style.display = deckSection.querySelector("#deckImages").children.length > 0 ? "block" : "none";
        sideboardSection.style.display = sideboardSection.querySelector("#sideboardImages").children.length > 0 ? "block" : "none";
        deckSectionManaCurve.style.display = "none";
        overlapControl.style.display = "none"; // タイル表示では非表示
    } else {
        deckSection.style.display = "none";
        sideboardSection.style.display = sideboardSection.querySelector("#sideboardImages").children.length > 0 ? "block" : "none";
        deckSectionManaCurve.style.display = deckSectionManaCurve.querySelector("#deckImagesManaCurve").children.length > 0 ? "block" : "none";
        overlapControl.style.display = "block"; // マナカーブ表示で表示
    }
}

async function generateDeckImages() {
    const deckInput = document.getElementById("deckInput").value.trim();
    const deckImagesDiv = document.getElementById("deckImages");
    const sideboardImagesDiv = document.getElementById("sideboardImages");
    const deckImagesManaCurveDiv = document.getElementById("deckImagesManaCurve");
    const errorDiv = document.getElementById("error");
    const deckSection = document.getElementById("deckSection");
    const sideboardSection = document.getElementById("sideboardSection");
    const deckSectionManaCurve = document.getElementById("deckSectionManaCurve");
    const downloadMainBtn = document.getElementById("downloadMainBtn");
    const downloadSideboardBtn = document.getElementById("downloadSideboardBtn");
    const downloadAllBtn = document.getElementById("downloadAllBtn");
    const progressDiv = document.getElementById("progress");
    const progressText = document.getElementById("progressText");

    // 初期化
    deckImagesDiv.innerHTML = "";
    sideboardImagesDiv.innerHTML = "";
    deckImagesManaCurveDiv.innerHTML = "";
    errorDiv.textContent = "";
    deckSection.style.display = "none";
    sideboardSection.style.display = "none";
    deckSectionManaCurve.style.display = "none";
    downloadMainBtn.style.display = "none";
    downloadSideboardBtn.style.display = "none";
    downloadAllBtn.style.display = "none";
    progressDiv.style.display = "none";

    if (!deckInput) {
        errorDiv.textContent = "デッキリストを入力してください";
        return;
    }

    // 行ごとに分割し、空行でセクションを分離
    const lines = deckInput.split("\n").map(line => line.trim());
    let mainDeckLines = [];
    let sideboardLines = [];
    let isSideboard = false;

    // 先頭の空行を無視しつつ、メインデッキとサイドボードを分離
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] == "" && mainDeckLines.length > 0 && !isSideboard) {
            isSideboard = true; // 最初の空行以降をサイドボードとみなす
            continue;
        }
        if (lines[i] !== "") { // 空行でない場合のみ追加
            if (!isSideboard) {
                mainDeckLines.push(lines[i]);
            } else {
                sideboardLines.push(lines[i]);
            }
        }
    }

    // カードリストを処理する関数
    async function processDeck(lines, tileTargetDiv, manaCurveTargetDiv, targetBoard = "", isSideboard = false) {
        const cardMap = new Map(); // カード名と数量を管理
    
        for (const line of lines) {
            const match = line.match(/^(\d+)\s+(.+)$/);
            if (match) {
                const quantity = parseInt(match[1], 10);
                let cardName = match[2];
                
                // 括弧とその中身を削除
                cardName = cardName.replace(/（[^）]+）/g, '');
                
                let setCode = null;
                let cardNo = null;
                
                // (セット略号) と番号を抽出
                const setMatch = cardName.match(/\s*\(([A-Z0-9]+)\)\s*(\d+)?$/);
                if (setMatch) {
                    setCode = setMatch[1];
                    cardNo = setMatch[2] ? parseInt(setMatch[2], 10) : null;
                    // マッチした部分をcardNameから削除
                    cardName = cardName.replace(/\s*\([A-Z0-9]+\)\s*\d*$/, '');
                }
                
                // 同一カード名でも setCode と cardNo が異なる場合を考慮して複合キーを生成
                const key = `${cardName}|${setCode || ''}|${cardNo || ''}`;
                if (cardMap.has(key)) {
                    const existing = cardMap.get(key);
                    existing.quantity += quantity;
                } else {
                    cardMap.set(key, { quantity, setCode, cardNo });
                }
            } else {
                if (line != "デッキ" && line != "サイドボード" && line != "Deck" && line != "Sideboard") {
                    errorDiv.textContent += `無効な行: "${line}"\n`;
                }
            }
        }

        const totalCards = cardMap.size; // 処理するカードの総数
        let processedCards = 0;

        // 進捗を更新する関数
        const updateProgress = () => {
            const percentage = totalCards > 0 ? Math.round((processedCards / totalCards) * 100) : 0;
            progressText.textContent = `${targetBoard} 処理中: ${processedCards}/${totalCards} (${percentage}%)`;
        };

        // カード画像のURLを取得
        const cardPromises = Array.from(cardMap.entries()).map(async ([key, { quantity, setCode, cardNo }], index) => {
            const cardName = key.split('|')[0]; // 複合キーからcardNameを抽出
            const result = await fetchCardImage(cardName, setCode, cardNo);
            await sleep(index * 100); // 1API毎に100ms遅延（Scryfall API利用規約）
            processedCards++;
            updateProgress(); // 進捗を更新
            return { cardName, quantity, ...result };
        });
    
        const cardResults = await Promise.all(cardPromises);
    
        // タイル表示
        cardResults.forEach(({ cardName, quantity, imageUrl }) => {
            const cardContainer = document.createElement("div");
            cardContainer.className = "card-container";
    
            if (imageUrl) {
                const img = document.createElement("img");
                img.src = imageUrl;  // Blob URL（例: blob://...）
                img.alt = cardName;
                img.className = "card-image";
                cardContainer.appendChild(img);
            } else {
                // カード画像のURLが取得できなかった場合は灰色の四角とカード名を表示する
                const placeholder = document.createElement("div");
                placeholder.style.width = "223px";
                placeholder.style.height = "310px";
                placeholder.style.backgroundColor = "#333333";
                placeholder.style.display = "flex";
                placeholder.style.alignItems = "center";
                placeholder.style.justifyContent = "center";
                placeholder.style.color = "white";
                placeholder.style.fontSize = "20px";
                placeholder.style.textAlign = "center";
                placeholder.textContent = cardName;
                cardContainer.appendChild(placeholder);
            }
    
            const quantityDiv = document.createElement("div");
            quantityDiv.className = "card-quantity";
            quantityDiv.textContent = quantity;
    
            cardContainer.appendChild(quantityDiv);
            tileTargetDiv.appendChild(cardContainer);
    
            if (!imageUrl) {
                errorDiv.textContent += `「${cardName}」の画像を取得できませんでした。\n`;
            }
        });
    
        // マナカーブ表示（メインデッキのみ）
        if (!isSideboard) {
            const manaCurveGroups = {
                "-1": { creatures: [], nonCreatures: [] },
                "2": { creatures: [], nonCreatures: [] },
                "3": { creatures: [], nonCreatures: [] },
                "4": { creatures: [], nonCreatures: [] },
                "5": { creatures: [], nonCreatures: [] },
                "6-": { creatures: [], nonCreatures: [] },
                "lands": []
            };

            cardResults.forEach(({ cardName, quantity, imageUrl, manaCost, isCreature, isLand }) => {
                if (!imageUrl) return;

                let group;
                if (isLand) {
                    group = "lands";
                } else {
                    if (manaCost <= 1) group = "-1";
                    else if (manaCost === 2) group = "2";
                    else if (manaCost === 3) group = "3";
                    else if (manaCost === 4) group = "4";
                    else if (manaCost === 5) group = "5";
                    else group = "6-";
                }

                // 複数枚表示のためにquantity分繰り返す
                for (let i = 0; i < quantity; i++) {
                    const cardContainer = document.createElement("div");
                    cardContainer.className = "card-container overlap"; // 重ねるためのクラスを追加
                    const img = document.createElement("img");
                    img.src = imageUrl;
                    img.alt = cardName;
                    img.className = "card-image";
                    cardContainer.appendChild(img);

                    if (isLand) {
                        manaCurveGroups[group].push(cardContainer);
                    } else if (isCreature) {
                        manaCurveGroups[group].creatures.push(cardContainer);
                    } else {
                        manaCurveGroups[group].nonCreatures.push(cardContainer);
                    }
                }
            });

            // マナカーブ表示の構築
            const manaCurveGrid = document.createElement("div");
            manaCurveGrid.className = "mana-curve-grid";

            // non-landsコンテナ
            const nonLands = document.createElement("div");
            nonLands.className = "non-lands";

            // creatures行
            const creaturesRow = document.createElement("div");
            creaturesRow.className = "creatures-row";
            ["-1", "2", "3", "4", "5", "6-"].forEach(mana => {
                const column = document.createElement("div");
                column.className = "mana-column";

                const header = document.createElement("div");
                header.className = "mana-column-header";
                header.textContent = mana;
                column.appendChild(header);

                const section = document.createElement("div");
                section.className = "mana-section";
                manaCurveGroups[mana].creatures.forEach(card => section.appendChild(card));
                column.appendChild(section);

                creaturesRow.appendChild(column);
            });
            nonLands.appendChild(creaturesRow);

            // non-creatures行
            const nonCreaturesRow = document.createElement("div");
            nonCreaturesRow.className = "non-creatures-row";
            ["-1", "2", "3", "4", "5", "6-"].forEach(mana => {
                const column = document.createElement("div");
                column.className = "mana-column";

                const section = document.createElement("div");
                section.className = "mana-section";
                manaCurveGroups[mana].nonCreatures.forEach(card => section.appendChild(card));
                column.appendChild(section);

                nonCreaturesRow.appendChild(column);
            });
            nonLands.appendChild(nonCreaturesRow);

            manaCurveGrid.appendChild(nonLands);

            // 土地の列
            const landsColumn = document.createElement("div");
            landsColumn.className = "lands-column";
            const landsHeader = document.createElement("div");
            landsHeader.className = "mana-column-header";
            landsHeader.textContent = "Land";
            landsColumn.appendChild(landsHeader);
            const landsSection = document.createElement("div");
            landsSection.className = "mana-section";
            manaCurveGroups["lands"].forEach(card => landsSection.appendChild(card));
            landsColumn.appendChild(landsSection);
            manaCurveGrid.appendChild(landsColumn);

            manaCurveTargetDiv.appendChild(manaCurveGrid);
        }

        const nameQuantityMap = new Map();
        cardMap.forEach(({ quantity }, key) => {
            const cardName = key.split('|')[0];
            nameQuantityMap.set(cardName, (nameQuantityMap.get(cardName) || 0) + quantity);
        });
    
        return nameQuantityMap; // cardName をキーとする数量マップを返す
    }

    // カード画像取得開始時に「カード画像取得中...」を表示
    progressDiv.style.display = "inline-block";
    progressText.textContent = "処理中: 0/0 (0%)";

    // メインデッキとサイドボードを処理
    const mainDeckMap = await processDeck(mainDeckLines, deckImagesDiv, deckImagesManaCurveDiv, "メインデッキ");
    let mainDeckCount = 0;
    mainDeckMap.forEach(quantity => mainDeckCount += quantity);

    let sideboardCount = 0;
    if (sideboardLines.length > 0) {
        const sideboardMap = await processDeck(sideboardLines, sideboardImagesDiv, null, "サイドボード", true);
        sideboardMap.forEach(quantity => sideboardCount += quantity);
    }

    // カード画像取得完了後に「カード画像取得中...」を非表示
    progressDiv.style.display = "none";

    // タイトルに枚数を追加して表示
    deckSection.querySelector("h2").textContent = `メインデッキ (${mainDeckCount})`;
    deckSectionManaCurve.querySelector("h2").textContent = `メインデッキ (${mainDeckCount})`;

    if (sideboardCount > 0) {
        sideboardSection.querySelector("h2").textContent = `サイドボード (${sideboardCount})`;
    }

    // メインデッキが生成されたらダウンロードボタンを表示
    if (mainDeckCount > 0) {
        downloadMainBtn.style.display = "inline-block";
    }
    if (sideboardCount > 0) {
        downloadSideboardBtn.style.display = "inline-block";
    }
    if (mainDeckCount > 0 || sideboardCount > 0) {
        downloadAllBtn.style.display = "inline-block";
    }

    toggleDisplayMode();
}

// イベントリスナーを追加
document.getElementById('generateBtn').addEventListener('click', generateDeckImages);
document.getElementById('downloadMainBtn').addEventListener('click', () => {
    const displayMode = document.querySelector('input[name="displayMode"]:checked').value;
    const sectionId = displayMode === "tile" ? 'deckSection' : 'deckSectionManaCurve';
    downloadSection(sectionId, 'main-deck.png');
});
document.getElementById('downloadSideboardBtn').addEventListener('click', () => downloadSection('sideboardSection', 'sideboard.png'));
document.getElementById('downloadAllBtn').addEventListener('click', downloadAll);
document.querySelectorAll('input[name="displayMode"]').forEach(radio => {
    radio.addEventListener('change', toggleDisplayMode);
});

// スライダーの値で重ね幅を更新
const overlapSlider = document.getElementById('overlapSlider');
const overlapValue = document.getElementById('overlapValue');

overlapSlider.addEventListener('input', () => {
    const value = parseInt(overlapSlider.value); // 実際の値（-310 から 0）
    const displayValue = value + 310; // 表示値（0 から 310）
    overlapValue.textContent = displayValue;
    document.querySelectorAll('.mana-section').forEach(section => {
        section.style.setProperty('--overlap-offset', `${value}px`);
    });
});