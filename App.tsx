
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { processStatement, extractTextFromContent } from './services/geminiService';
import type { AccountInfo, Transaction, GeminiResponse } from './types';
import { UploadIcon, ProcessIcon, DownloadIcon, CopyIcon, OpenHtmlIcon, MicrophoneIcon } from './components/Icons';
import ChatAssistant from './components/ChatAssistant';

// Helper to extract text or images from various file types
const extractFromFile = async (file: File): Promise<{ text: string | null; images: { mimeType: string; data: string }[] }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const content = e.target?.result as ArrayBuffer;
                if (!content) {
                    return reject(new Error('File content is empty.'));
                }

                if (file.type === 'application/pdf') {
                    const pdf = await (window as any).pdfjsLib.getDocument({ data: content }).promise;
                    const pageImages: { mimeType: string, data: string }[] = [];
                    
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const viewport = page.getViewport({ scale: 10.0 }); // Increased scale dramatically for maximum OCR accuracy as per user request.
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        if (!context) throw new Error('Could not get canvas context');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        await page.render({ canvasContext: context, viewport: viewport }).promise;
                        
                        // Use PNG for lossless image quality
                        const dataUrl = canvas.toDataURL('image/png'); 
                        const base64Data = dataUrl.split(',')[1];
                        pageImages.push({ mimeType: 'image/png', data: base64Data });
                    }
                    resolve({ text: null, images: pageImages });
                } else if (file.type.startsWith('image/')) {
                    const base64Data = btoa(new Uint8Array(content).reduce((data, byte) => data + String.fromCharCode(byte), ''));
                    resolve({ text: null, images: [{ mimeType: file.type, data: base64Data }] });
                } else { // Text-based files
                    let extractedText = '';
                    if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                        const result = await (window as any).mammoth.extractRawText({ arrayBuffer: content });
                        extractedText = result.value;
                    } else if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
                        const workbook = (window as any).XLSX.read(content, { type: 'array' });
                        workbook.SheetNames.forEach((sheetName: string) => {
                            const worksheet = workbook.Sheets[sheetName];
                            extractedText += (window as any).XLSX.utils.sheet_to_csv(worksheet);
                        });
                    } else { // Plain text
                        extractedText = new TextDecoder().decode(content);
                    }
                    resolve({ text: extractedText, images: [] });
                }
            } catch (error) {
                console.error("Error during file extraction:", error);
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
};


const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('vi-VN').format(value);
};

interface ResultTableProps {
    accountInfo: AccountInfo;
    transactions: Transaction[];
    openingBalance: number;
    onUpdateTransaction: (index: number, field: 'debit' | 'credit' | 'fee' | 'vat', value: number) => void;
    onUpdateTransactionString: (index: number, field: 'transactionCode' | 'date' | 'description', value: string) => void;
    balanceMismatchWarning: string | null;
}

const ResultTable: React.FC<ResultTableProps> = ({ accountInfo, transactions, openingBalance, onUpdateTransaction, onUpdateTransactionString, balanceMismatchWarning }) => {
    const [copySuccess, setCopySuccess] = useState('');
    type EditableTransactionField = 'transactionCode' | 'date' | 'description' | 'debit' | 'credit' | 'fee' | 'vat';
    const [listeningFor, setListeningFor] = useState<{ index: number; field: EditableTransactionField } | null>(null);
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Speech Recognition not supported in this browser.");
            return;
        }
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'vi-VN';

        recognition.onresult = (event: any) => {
            const last = event.results.length - 1;
            const transcript = event.results[last][0].transcript.trim();
            
            if (listeningFor) {
                 const isNumericField = ['debit', 'credit', 'fee', 'vat'].includes(listeningFor.field);

                if (isNumericField) {
                    // Basic Vietnamese number parsing
                    let numericValue = parseFloat(transcript.replace(/,/g, '').replace(/\./g, '').replace(/\s/g, ''));
                    if (!isNaN(numericValue)) {
                        if (transcript.toLowerCase().includes('triệu')) {
                            numericValue *= 1000000;
                        } else if (transcript.toLowerCase().includes('nghìn') || transcript.toLowerCase().includes('ngàn')) {
                            numericValue *= 1000;
                        }
                        onUpdateTransaction(listeningFor.index, listeningFor.field as 'debit' | 'credit' | 'fee' | 'vat', numericValue);
                    }
                } else {
                    // It's a string field
                    onUpdateTransactionString(listeningFor.index, listeningFor.field as 'transactionCode' | 'date' | 'description', transcript);
                }
            }
        };

        recognition.onerror = (event: any) => {
            console.error("Speech recognition error:", event.error);
            let errorMessage = `Đã xảy ra lỗi nhận dạng giọng nói: ${event.error}.`;
            if (event.error === 'no-speech') {
                errorMessage = "Không nghe thấy giọng nói. Vui lòng đảm bảo micrô của bạn đang hoạt động và thử nói lại.";
            } else if (event.error === 'audio-capture') {
                errorMessage = "Không tìm thấy micrô. Vui lòng kiểm tra xem micrô đã được kết nối và cấp quyền trong trình duyệt.";
            } else if (event.error === 'not-allowed') {
                errorMessage = "Quyền truy cập micrô đã bị từ chối. Vui lòng vào cài đặt trình duyệt để cấp quyền.";
            }
            alert(errorMessage);
        };


        recognition.onend = () => {
            setListeningFor(null);
        };
        
        recognitionRef.current = recognition;

    }, [onUpdateTransaction, onUpdateTransactionString, listeningFor]);
    
    const handleVoiceInput = (index: number, field: EditableTransactionField) => {
        if (recognitionRef.current) {
            if (listeningFor) {
                recognitionRef.current.stop();
                setListeningFor(null);
            } else {
                setListeningFor({ index, field });
                recognitionRef.current.start();
            }
        } else {
             alert("Trình duyệt không hỗ trợ nhận dạng giọng nói.");
        }
    };


    const { totalDebit, totalCredit, totalFee, totalVat, calculatedEndingBalance } = useMemo(() => {
        const totals = transactions.reduce((acc, tx) => {
            acc.totalDebit += tx.debit;
            acc.totalCredit += tx.credit;
            acc.totalFee += tx.fee || 0;
            acc.totalVat += tx.vat || 0;
            return acc;
        }, { totalDebit: 0, totalCredit: 0, totalFee: 0, totalVat: 0 });
        
        const calculatedEndingBalance = openingBalance + totals.totalDebit - totals.totalCredit - totals.totalFee - totals.totalVat;
        return { ...totals, calculatedEndingBalance };
    }, [transactions, openingBalance]);


    const generateTableData = useCallback(() => {
        const headers = ["Mã GD", "Ngày giá trị", "Nội dung thanh toán", "Phát Sinh Nợ", "Phát Sinh Có", "Phí", "Thuế VAT", "Số dư"];
        let runningBalance = openingBalance;
        
        const rows = transactions.map(tx => {
            runningBalance = runningBalance + tx.debit - tx.credit - (tx.fee || 0) - (tx.vat || 0);
            return [
                tx.transactionCode || '',
                tx.date,
                tx.description,
                tx.debit,
                tx.credit,
                tx.fee || 0,
                tx.vat || 0,
                runningBalance
            ];
        });

        const initialRow = ['', '', 'Số dư đầu kỳ', '', '', '', '', openingBalance];
        
        const totalRow = ['', '', 'Cộng phát sinh', totalDebit, totalCredit, totalFee, totalVat, calculatedEndingBalance];

        return { headers, rows: [initialRow, ...rows, totalRow] };
    }, [transactions, openingBalance, totalDebit, totalCredit, totalFee, totalVat, calculatedEndingBalance]);


    const handleDownload = () => {
        const { headers, rows } = generateTableData();
        const accountInfoRows = [
            `"Tên tài khoản:","${accountInfo.accountName || 'N/A'}"`,
            `"Số tài khoản:","${accountInfo.accountNumber || 'N/A'}"`,
            `"Ngân hàng:","${accountInfo.bankName || 'N/A'}"`,
            `"Chi nhánh:","${accountInfo.branch || 'N/A'}"`,
            '' // Empty line for spacing
        ];
        const csvContent = "data:text/csv;charset=utf-8," 
            + [...accountInfoRows, headers.join(','), ...rows.map(row => row.map(item => `"${String(item).replace(/"/g, '""')}"`).join(','))].join('\n');
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "so_ke_ke_toan.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleCopy = () => {
        const { headers, rows } = generateTableData();
         const accountInfoRows = [
            `Tên tài khoản:\t${accountInfo.accountName || 'N/A'}`,
            `Số tài khoản:\t${accountInfo.accountNumber || 'N/A'}`,
            `Ngân hàng:\t${accountInfo.bankName || 'N/A'}`,
            `Chi nhánh:\t${accountInfo.branch || 'N/A'}`,
            '' // Empty line for spacing
        ];
        const tsvContent = [...accountInfoRows, headers.join('\t'), ...rows.map(row => row.join('\t'))].join('\n');
        
        navigator.clipboard.writeText(tsvContent).then(() => {
            setCopySuccess('Đã sao chép vào clipboard!');
            setTimeout(() => setCopySuccess(''), 2000);
        }, () => {
            setCopySuccess('Sao chép thất bại.');
            setTimeout(() => setCopySuccess(''), 2000);
        });
    };

    const handleOpenHtml = () => {
        let currentBalance = openingBalance;
        const tableRowsHtml = transactions.map(tx => {
            currentBalance += tx.debit - tx.credit - (tx.fee || 0) - (tx.vat || 0);
            return `
                <tr>
                    <td>${tx.transactionCode || ''}</td>
                    <td>${tx.date}</td>
                    <td>${tx.description}</td>
                    <td style="color: green;">${tx.debit > 0 ? formatCurrency(tx.debit) : ''}</td>
                    <td style="color: red;">${tx.credit > 0 ? formatCurrency(tx.credit) : ''}</td>
                    <td>${(tx.fee || 0) > 0 ? formatCurrency(tx.fee!) : ''}</td>
                    <td>${(tx.vat || 0) > 0 ? formatCurrency(tx.vat!) : ''}</td>
                    <td>${formatCurrency(currentBalance)}</td>
                </tr>
            `;
        }).join('');

        const htmlContent = `
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Sổ Kế Toán</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 2em; color: #333; }
                    h1, h3 { color: #1a202c; }
                    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
                    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                    th { background-color: #f2f2f2; font-weight: bold; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    tr:hover { background-color: #f1f1f1; }
                    td:nth-child(4), td:nth-child(5), td:nth-child(6), td:nth-child(7), td:nth-child(8) { text-align: right; font-family: monospace; }
                    tfoot tr { background-color: #f8fafc; font-weight: bold; }
                </style>
            </head>
            <body>
                <h1>Bảng Kê Kế Toán</h1>
                <h3>Thông tin tài khoản</h3>
                <p><strong>Tên tài khoản:</strong> ${accountInfo.accountName || 'N/A'}</p>
                <p><strong>Số tài khoản:</strong> ${accountInfo.accountNumber || 'N/A'}</p>
                <p><strong>Ngân hàng:</strong> ${accountInfo.bankName || 'N/A'}</p>
                <p><strong>Chi nhánh:</strong> ${accountInfo.branch || 'N/A'}</p>
                
                <table>
                    <thead>
                        <tr>
                            <th>Mã GD</th>
                            <th>Ngày</th>
                            <th>Nội dung</th>
                            <th>PS Nợ</th>
                            <th>PS Có</th>
                            <th>Phí</th>
                            <th>Thuế VAT</th>
                            <th>Số dư</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="font-weight: bold;">
                            <td colspan="7" style="text-align: center;">Số dư đầu kỳ</td>
                            <td>${formatCurrency(openingBalance)}</td>
                        </tr>
                        ${tableRowsHtml}
                    </tbody>
                     <tfoot>
                        <tr style="font-weight: bold; border-top: 2px solid #e2e8f0;">
                            <td colspan="3" style="text-align: center;">Cộng phát sinh</td>
                            <td style="text-align: right; color: green;">${formatCurrency(totalDebit)}</td>
                            <td style="text-align: right; color: red;">${formatCurrency(totalCredit)}</td>
                            <td style="text-align: right;">${formatCurrency(totalFee)}</td>
                            <td style="text-align: right;">${formatCurrency(totalVat)}</td>
                            <td style="text-align: right;">${formatCurrency(calculatedEndingBalance)}</td>
                        </tr>
                    </tfoot>
                </table>
            </body>
            </html>
        `;

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    };


    let currentBalance = openingBalance;
    const editableCellClass = "px-1 py-1 bg-transparent text-right w-full focus:bg-white dark:focus:bg-gray-900 focus:ring-1 focus:ring-indigo-500 rounded";
    const editableTextCellClass = "px-1 py-1 bg-transparent text-left w-full focus:bg-white dark:focus:bg-gray-900 focus:ring-1 focus:ring-indigo-500 rounded";

    return (
        <div className="mt-8">
            <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-gray-200">KẾT QUẢ ĐẦU RA</h2>
            
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg my-4 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm text-gray-800 dark:text-gray-200">
                <div><strong className="font-semibold text-gray-600 dark:text-gray-400">Tên TK:</strong> {accountInfo.accountName || 'N/A'}</div>
                <div><strong className="font-semibold text-gray-600 dark:text-gray-400">Số TK:</strong> {accountInfo.accountNumber || 'N/A'}</div>
                <div><strong className="font-semibold text-gray-600 dark:text-gray-400">Ngân hàng:</strong> {accountInfo.bankName || 'N/A'}</div>
                <div><strong className="font-semibold text-gray-600 dark:text-gray-400">Chi nhánh:</strong> {accountInfo.branch || 'N/A'}</div>
            </div>

            {balanceMismatchWarning && (
                <div className="my-4 p-4 bg-yellow-100 dark:bg-yellow-900 border-l-4 border-yellow-500 text-yellow-700 dark:text-yellow-200 rounded-lg shadow-md">
                    <p className="font-bold">Cảnh báo đối chiếu!</p>
                    <p>{balanceMismatchWarning}</p>
                </div>
            )}
            <div className="flex justify-end my-4 space-x-2">
                <button onClick={handleCopy} className="flex items-center px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors">
                    <CopyIcon /> {copySuccess || 'Copy Bảng'}
                </button>
                <button onClick={handleDownload} className="flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors">
                    <DownloadIcon /> Download CSV
                </button>
                <button onClick={handleOpenHtml} className="flex items-center px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors">
                    <OpenHtmlIcon /> Mở HTML
                </button>
            </div>
            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow">
                <table className="min-w-full text-sm text-left text-gray-500 dark:text-gray-400">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400 sticky top-0 z-10">
                        <tr>
                            {["Mã GD", "Ngày", "Nội dung", "PS Nợ", "PS Có", "Phí", "Thuế VAT", "Số dư"].map((header, idx) => (
                                <th key={header} scope="col" className={`px-2 md:px-6 py-3 ${idx === 0 ? 'sticky left-0 bg-gray-50 dark:bg-gray-700' : ''}`}>{header}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 font-semibold">
                            <td colSpan={7} className="px-2 md:px-6 py-4 text-center sticky left-0 bg-white dark:bg-gray-800">Số dư đầu kỳ</td>
                            <td className="px-2 md:px-6 py-4 text-right">{formatCurrency(openingBalance)}</td>
                        </tr>
                        {transactions.map((tx, index) => {
                            currentBalance = openingBalance + transactions.slice(0, index + 1).reduce((acc, currentTx) => acc + currentTx.debit - currentTx.credit - (currentTx.fee || 0) - (currentTx.vat || 0), 0);
                            const isListening = (field: EditableTransactionField) => listeningFor?.index === index && listeningFor?.field === field;

                            return (
                                <tr key={index} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600">
                                    <td className="px-2 md:px-6 py-4 sticky left-0 bg-white dark:bg-gray-800">
                                        <div className="flex items-center justify-start space-x-2">
                                            <input
                                                type="text"
                                                value={tx.transactionCode || ''}
                                                onChange={(e) => onUpdateTransactionString(index, 'transactionCode', e.target.value)}
                                                className={editableTextCellClass}
                                            />
                                            <MicrophoneIcon isListening={isListening('transactionCode')} onClick={() => handleVoiceInput(index, 'transactionCode')} />
                                        </div>
                                    </td>
                                    <td className="px-2 md:px-6 py-4">
                                         <div className="flex items-center justify-start space-x-2">
                                            <input
                                                type="text"
                                                value={tx.date}
                                                onChange={(e) => onUpdateTransactionString(index, 'date', e.target.value)}
                                                className={editableTextCellClass}
                                            />
                                            <MicrophoneIcon isListening={isListening('date')} onClick={() => handleVoiceInput(index, 'date')} />
                                        </div>
                                    </td>
                                    <td className="px-2 md:px-6 py-4 max-w-xs">
                                         <div className="flex items-center justify-start space-x-2">
                                            <input
                                                type="text"
                                                value={tx.description}
                                                onChange={(e) => onUpdateTransactionString(index, 'description', e.target.value)}
                                                className={`${editableTextCellClass} truncate`}
                                            />
                                            <MicrophoneIcon isListening={isListening('description')} onClick={() => handleVoiceInput(index, 'description')} />
                                        </div>
                                    </td>
                                    <td className="px-2 md:px-6 py-4 text-right text-green-600 dark:text-green-400">
                                        <div className="flex items-center justify-end space-x-2">
                                            <input
                                                type="text"
                                                value={new Intl.NumberFormat('vi-VN').format(tx.debit)}
                                                onChange={(e) => {
                                                     const value = parseFloat(e.target.value.replace(/\./g, ''));
                                                     onUpdateTransaction(index, 'debit', isNaN(value) ? 0 : value)
                                                }}
                                                className={editableCellClass}
                                            />
                                            <MicrophoneIcon isListening={isListening('debit')} onClick={() => handleVoiceInput(index, 'debit')} />
                                        </div>
                                    </td>
                                    <td className="px-2 md:px-6 py-4 text-right text-red-600 dark:text-red-400">
                                         <div className="flex items-center justify-end space-x-2">
                                            <input
                                                type="text"
                                                value={new Intl.NumberFormat('vi-VN').format(tx.credit)}
                                                onChange={(e) => {
                                                     const value = parseFloat(e.target.value.replace(/\./g, ''));
                                                     onUpdateTransaction(index, 'credit', isNaN(value) ? 0 : value)
                                                }}
                                                className={editableCellClass}
                                            />
                                            <MicrophoneIcon isListening={isListening('credit')} onClick={() => handleVoiceInput(index, 'credit')} />
                                        </div>
                                    </td>
                                     <td className="px-2 md:px-6 py-4 text-right">
                                         <div className="flex items-center justify-end space-x-2">
                                            <input
                                                type="text"
                                                value={new Intl.NumberFormat('vi-VN').format(tx.fee || 0)}
                                                onChange={(e) => {
                                                     const value = parseFloat(e.target.value.replace(/\./g, ''));
                                                     onUpdateTransaction(index, 'fee', isNaN(value) ? 0 : value)
                                                }}
                                                className={editableCellClass}
                                            />
                                            <MicrophoneIcon isListening={isListening('fee')} onClick={() => handleVoiceInput(index, 'fee')} />
                                        </div>
                                    </td>
                                     <td className="px-2 md:px-6 py-4 text-right">
                                         <div className="flex items-center justify-end space-x-2">
                                            <input
                                                type="text"
                                                value={new Intl.NumberFormat('vi-VN').format(tx.vat || 0)}
                                                onChange={(e) => {
                                                     const value = parseFloat(e.target.value.replace(/\./g, ''));
                                                     onUpdateTransaction(index, 'vat', isNaN(value) ? 0 : value)
                                                }}
                                                className={editableCellClass}
                                            />
                                            <MicrophoneIcon isListening={isListening('vat')} onClick={() => handleVoiceInput(index, 'vat')} />
                                        </div>
                                    </td>
                                    <td className="px-2 md:px-6 py-4 text-right font-medium">{formatCurrency(currentBalance)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                     <tfoot className="bg-gray-50 dark:bg-gray-700 sticky bottom-0">
                        <tr className="font-semibold text-gray-900 dark:text-white">
                            <td colSpan={3} className="px-2 md:px-6 py-3 text-center text-base sticky left-0 bg-gray-50 dark:bg-gray-700">Cộng phát sinh</td>
                            <td className="px-2 md:px-6 py-3 text-right text-base text-green-600 dark:text-green-400">{formatCurrency(totalDebit)}</td>
                            <td className="px-2 md:px-6 py-3 text-right text-base text-red-600 dark:text-red-400">{formatCurrency(totalCredit)}</td>
                            <td className="px-2 md:px-6 py-3 text-right text-base">{formatCurrency(totalFee)}</td>
                            <td className="px-2 md:px-6 py-3 text-right text-base">{formatCurrency(totalVat)}</td>
                            <td className="px-2 md:px-6 py-3 text-right text-base font-bold">{formatCurrency(calculatedEndingBalance)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};

type LoadingState = 'idle' | 'extracting' | 'processing';

export default function App() {
    const [openingBalance, setOpeningBalance] = useState('');
    const [statementContent, setStatementContent] = useState<string>(() => localStorage.getItem('statementContent') || '');
    const [fileName, setFileName] = useState<string>(() => localStorage.getItem('fileName') || '');
    const [loadingState, setLoadingState] = useState<LoadingState>('idle');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<GeminiResponse | null>(null);
    const [balanceMismatchWarning, setBalanceMismatchWarning] = useState<string | null>(null);
    const [history, setHistory] = useState<GeminiResponse[]>([]);
    const progressInterval = useRef<number | null>(null);

    const isLoading = loadingState !== 'idle';
    
    useEffect(() => {
        localStorage.setItem('fileName', fileName);
    }, [fileName]);

    useEffect(() => {
        localStorage.setItem('statementContent', statementContent);
    }, [statementContent]);

    useEffect(() => {
        return () => {
            if (progressInterval.current) {
                clearInterval(progressInterval.current);
            }
        };
    }, []);
    
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            setResult(null);
            setStatementContent('');
            setOpeningBalance('');
            setBalanceMismatchWarning(null);
            setLoadingState('extracting');
            setError(null);
            startProgress("Đang trích xuất văn bản từ file...");

            const fileNames = Array.from(files).map((f: File) => f.name);
            if (fileNames.length <= 3) {
                setFileName(fileNames.join(', '));
            } else {
                setFileName(`${fileNames.length} tệp đã chọn`);
            }

            try {
                const extractionPromises = Array.from(files).map((file: File) => extractFromFile(file));
                const results = await Promise.all(extractionPromises);
                
                const allTexts = results.map(r => r.text).filter(Boolean);
                const allImages = results.flatMap(r => r.images);

                let combinedText = allTexts.join('\n\n--- TÁCH BIỆT SAO KÊ ---\n\n');

                if(allImages.length > 0) {
                    const textFromImages = await extractTextFromContent({ images: allImages });
                    combinedText += '\n\n' + textFromImages;
                }

                setStatementContent(combinedText.trim());

            } catch (err) {
                if (err instanceof Error) {
                    setError(`Lỗi đọc file: ${err.message}`);
                } else {
                     setError(`Lỗi đọc file: ${String(err)}`);
                }
                setFileName('');
            } finally {
                finishProgress();
                setLoadingState('idle');
            }
        }
    };

    const startProgress = (message: string) => {
        setProgress(0);
        if (progressInterval.current) clearInterval(progressInterval.current);

        progressInterval.current = window.setInterval(() => {
            setProgress(prev => {
                if (prev >= 95) {
                    if (progressInterval.current) clearInterval(progressInterval.current);
                    return 95;
                }
                const newProgress = Math.min(prev + Math.random() * 5, 95);
                return newProgress;
            });
        }, 300);
    };


    const finishProgress = () => {
        if (progressInterval.current) clearInterval(progressInterval.current);
        setProgress(100);
        setTimeout(() => {
            setLoadingState('idle');
            setProgress(0);
        } , 500);
    };

    const handleSubmit = async () => {
        if (!statementContent) {
            setError('Không có nội dung sao kê để xử lý. Vui lòng upload file hoặc dán nội dung.');
            return;
        }
        setLoadingState('processing');
        setError(null);
        setResult(null);
        setBalanceMismatchWarning(null);
        setHistory([]); // Reset history on new processing
        startProgress("AI đang phân tích nghiệp vụ...");

        try {
            const data = await processStatement({ text: statementContent });
            
            setOpeningBalance(data.openingBalance?.toString() ?? '0');
            setResult(data);
            setHistory([data]); // Set initial state for undo

            // Balance Cross-Check Logic
            if (data.endingBalance !== undefined && data.endingBalance !== 0) {
                const { totalDebit, totalCredit, totalFee, totalVat } = data.transactions.reduce((acc, tx) => {
                    acc.totalDebit += tx.debit;
                    acc.totalCredit += tx.credit;
                    acc.totalFee += tx.fee || 0;
                    acc.totalVat += tx.vat || 0;
                    return acc;
                }, { totalDebit: 0, totalCredit: 0, totalFee: 0, totalVat: 0 });

                const openingBal = data.openingBalance || 0;
                const calculatedEndingBalance = openingBal + totalDebit - totalCredit - totalFee - totalVat;
                
                // Use a small tolerance for floating point comparison
                if (Math.abs(calculatedEndingBalance - data.endingBalance) > 1) { // Tolerance of 1 unit (e.g., 1 VND)
                    setBalanceMismatchWarning(`Số dư cuối kỳ tính toán (${formatCurrency(calculatedEndingBalance)}) không khớp với số dư trên sao kê (${formatCurrency(data.endingBalance)}). Chênh lệch: ${formatCurrency(calculatedEndingBalance - data.endingBalance)}. Vui lòng rà soát lại các giao dịch.`);
                }
            }

        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('Đã xảy ra lỗi không xác định khi xử lý sao kê.');
            }
        } finally {
            finishProgress();
        }
    };
    
    const handleTransactionUpdate = (index: number, field: 'debit' | 'credit' | 'fee' | 'vat', value: number) => {
        if (!result) return;
        
        setHistory(prev => [...prev, result]); // Save current state before updating

        const updatedTransactions = [...result.transactions];
        const transactionToUpdate = { ...updatedTransactions[index] };

        if (field === 'fee' || field === 'vat') {
            (transactionToUpdate as any)[field] = value;
        } else {
            transactionToUpdate[field] = value;
        }
        
        updatedTransactions[index] = transactionToUpdate;

        setResult({ ...result, transactions: updatedTransactions });
    };

    const handleTransactionStringUpdate = (index: number, field: 'transactionCode' | 'date' | 'description', value: string) => {
        if (!result) return;
        
        setHistory(prev => [...prev, result]); // Save current state before updating

        const updatedTransactions = [...result.transactions];
        const transactionToUpdate = { ...updatedTransactions[index] };
        
        transactionToUpdate[field] = value;
        
        updatedTransactions[index] = transactionToUpdate;

        setResult({ ...result, transactions: updatedTransactions });
    };

    const handleTransactionAdd = (transaction: Transaction) => {
        if (!result) return;
        setHistory(prev => [...prev, result]); // Save current state before adding
        
        const newTransaction = {
            transactionCode: transaction.transactionCode || '',
            date: transaction.date || new Date().toLocaleDateString('vi-VN'),
            description: transaction.description || 'Giao dịch mới',
            debit: transaction.debit || 0,
            credit: transaction.credit || 0,
            fee: transaction.fee || 0,
            vat: transaction.vat || 0,
        };

        const updatedTransactions = [...result.transactions, newTransaction];
        setResult({ ...result, transactions: updatedTransactions });
    };

    const handleUndoLastChange = () => {
        if (history.length <= 1) return; // Don't undo the initial state

        const lastState = history[history.length - 1];
        setResult(lastState);
        setHistory(prev => prev.slice(0, -1));
    };


    const getLoadingMessage = () => {
        switch(loadingState) {
            case 'extracting': return `Đang trích xuất văn bản... ${Math.round(progress)}%`;
            case 'processing': return `AI đang phân tích... ${Math.round(progress)}%`;
            default: return '';
        }
    }
    
    // Recalculate warning on data change
    useEffect(() => {
        if (!result) {
            setBalanceMismatchWarning(null);
            return;
        };

        const { openingBalance: openingBal, endingBalance: extractedEndingBalance, transactions } = result;
        
        if (extractedEndingBalance !== undefined && extractedEndingBalance !== 0) {
            const { totalDebit, totalCredit, totalFee, totalVat } = transactions.reduce((acc, tx) => {
                acc.totalDebit += tx.debit;
                acc.totalCredit += tx.credit;
                acc.totalFee += tx.fee || 0;
                acc.totalVat += tx.vat || 0;
                return acc;
            }, { totalDebit: 0, totalCredit: 0, totalFee: 0, totalVat: 0 });

            const calculatedEndingBalance = (parseFloat(openingBalance) || 0) + totalDebit - totalCredit - totalFee - totalVat;

            if (Math.abs(calculatedEndingBalance - extractedEndingBalance) > 1) {
                setBalanceMismatchWarning(`Số dư cuối kỳ tính toán (${formatCurrency(calculatedEndingBalance)}) không khớp với số dư trên sao kê (${formatCurrency(extractedEndingBalance)}). Chênh lệch: ${formatCurrency(calculatedEndingBalance - extractedEndingBalance)}. Vui lòng rà soát lại các giao dịch.`);
            } else {
                setBalanceMismatchWarning(null);
            }
        }

    }, [result, openingBalance]);

    return (
        <div className="min-h-screen text-gray-800 dark:text-gray-200 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-teal-400">
                        Chuyển Đổi Sổ Phụ Ngân Hàng Thành Sổ Kế Toán
                    </h1>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">
                        Upload sao kê, kiểm tra số dư và nhận ngay bảng dữ liệu theo chuẩn kế toán.
                    </p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
                        <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">THÔNG TIN ĐẦU VÀO</h2>
                        
                        <div className={`transition-opacity duration-300 ease-in-out ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="mb-4">
                                 <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    1. Upload file Sao kê (OCR bằng AI)
                                </label>
                                <label htmlFor="file-upload" className="relative cursor-pointer bg-white dark:bg-gray-700 rounded-md font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500 border border-gray-300 dark:border-gray-600 flex items-center justify-center p-4">
                                    <UploadIcon/>
                                    <span>{fileName || 'Chọn tệp (.pdf, .png, .jpg...)'}</span>
                                    <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".pdf,.docx,.xlsx,.txt,.png,.jpg,.jpeg,.bmp" multiple/>
                                </label>
                            </div>
                            
                            <div>
                                <label htmlFor="statementContent" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    2. Nội dung sao kê (kiểm tra & chỉnh sửa nếu cần)
                                </label>
                                <textarea
                                    id="statementContent"
                                    rows={8}
                                    value={statementContent}
                                    onChange={(e) => setStatementContent(e.target.value)}
                                    placeholder="Nội dung văn bản từ file của bạn sẽ hiện ở đây sau khi upload..."
                                    className="w-full px-3 py-2 text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>

                             <div className="mt-4">
                                <label htmlFor="openingBalance" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    3. Số dư đầu kỳ (AI sẽ tự động điền hoặc bạn có thể sửa)
                                </label>
                                <input
                                    type="text"
                                    id="openingBalance"
                                    value={openingBalance ? new Intl.NumberFormat('vi-VN').format(parseFloat(openingBalance.replace(/\./g, ''))) : ''}
                                    onChange={(e) => {
                                        const value = e.target.value.replace(/\./g, '');
                                        if (!isNaN(parseFloat(value)) || value === '') {
                                            setOpeningBalance(value);
                                        }
                                    }}
                                    placeholder="Nhập hoặc chỉnh sửa số dư đầu kỳ..."
                                    className="w-full px-3 py-2 text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                        </div>

                        {isLoading && (
                            <div className="mt-4">
                                <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                                    <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                </div>
                                <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-1">{getLoadingMessage()}</p>
                            </div>
                        )}

                         <div className="mt-6">
                             <button
                                 onClick={handleSubmit}
                                 disabled={isLoading || !statementContent}
                                 className="w-full flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed transition-colors"
                             >
                                 {loadingState === 'processing' ? <><ProcessIcon /> Đang phân tích...</> : '4. Xử lý Sao Kê'}
                             </button>
                         </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
                        <h2 className="text-2xl font-bold mb-4">Quy trình làm việc</h2>
                        <ul className="space-y-4 text-gray-600 dark:text-gray-400">
                            <li className="flex items-start">
                                <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-indigo-500 text-white font-bold text-sm mr-3">1</span>
                                <span><b>Upload & Trích xuất:</b> Chọn file sao kê. AI sẽ tự động đọc và điền văn bản thô vào ô bên cạnh.</span>
                            </li>
                            <li className="flex items-start">
                                <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-indigo-500 text-white font-bold text-sm mr-3">2</span>
                                <span><b>Kiểm tra Văn bản:</b> Đọc lại văn bản đã được trích xuất. Nếu có lỗi OCR (ví dụ sai số), hãy sửa trực tiếp trong ô văn bản.</span>
                            </li>
                             <li className="flex items-start">
                                <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-indigo-500 text-white font-bold text-sm mr-3">3</span>
                                <span><b>Xác nhận Số dư:</b> Kiểm tra hoặc nhập số dư đầu kỳ.</span>
                            </li>
                            <li className="flex items-start">
                                <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-indigo-500 text-white font-bold text-sm mr-3">4</span>
                                <span><b>Xử lý & Đối chiếu:</b> Nhấn nút để AI phân tích và tạo bảng. Hệ thống sẽ <b>tự động đối chiếu số dư</b> và cảnh báo nếu có sai lệch.</span>
                            </li>
                            <li className="flex items-start">
                                <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-green-500 text-white font-bold text-sm mr-3">5</span>
                                <span><b>Chỉnh sửa Báo cáo:</b> Sau khi có kết quả, bạn có thể <b>nhấp trực tiếp vào các ô số liệu</b> để sửa, <b>dùng micro 🎤</b>, hoặc <b>sử dụng Trợ lý AI 💬</b> để ra lệnh (bao gồm cả việc dán ảnh/văn bản để thêm giao dịch).</span>
                            </li>
                            <li className="flex items-start">
                                <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-indigo-500 text-white font-bold text-sm mr-3">6</span>
                                <span><b>Xuất Báo cáo:</b> Sử dụng các nút "Copy", "Download" hoặc "Mở HTML" để lấy báo cáo cuối cùng đã được tinh chỉnh.</span>
                            </li>
                        </ul>
                    </div>
                </div>

                {error && (
                    <div className="mt-8 p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 rounded-lg">
                        <p className="font-bold">Đã xảy ra lỗi!</p>
                        <p>{error}</p>
                    </div>
                )}
                
                {result && (
                  <>
                    <ResultTable 
                        accountInfo={result.accountInfo} 
                        transactions={result.transactions} 
                        openingBalance={parseFloat(openingBalance) || 0}
                        onUpdateTransaction={handleTransactionUpdate}
                        onUpdateTransactionString={handleTransactionStringUpdate}
                        balanceMismatchWarning={balanceMismatchWarning}
                    />
                    <ChatAssistant 
                        reportData={result}
                        rawStatementContent={statementContent}
                        onUpdateTransaction={handleTransactionUpdate}
                        onUndoLastChange={handleUndoLastChange}
                        onTransactionAdd={handleTransactionAdd}
                    />
                  </>
                )}
            </div>
        </div>
    );
}
