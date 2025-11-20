
import { GoogleGenAI, Type } from "@google/genai";
import type { GeminiResponse, AIChatResponse, ChatMessage, Transaction } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    openingBalance: { type: Type.NUMBER, description: "Số dư đầu kỳ của sao kê. Nếu không tìm thấy, trả về 0." },
    endingBalance: { type: Type.NUMBER, description: "Số dư cuối kỳ của sao kê. Nếu không tìm thấy, trả về 0." },
    accountInfo: {
      type: Type.OBJECT,
      properties: {
        accountName: { type: Type.STRING, description: "Tên chủ tài khoản" },
        accountNumber: { type: Type.STRING, description: "Số tài khoản" },
        bankName: { type: Type.STRING, description: "Tên ngân hàng" },
        branch: { type: Type.STRING, description: "Tên chi nhánh" },
      },
      required: ["accountName", "accountNumber", "bankName", "branch"],
    },
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          transactionCode: { type: Type.STRING, description: "Mã giao dịch nếu có" },
          date: { type: Type.STRING, description: "Ngày giao dịch theo định dạng DD/MM/YYYY" },
          description: { type: Type.STRING, description: "Nội dung giao dịch" },
          debit: { type: Type.NUMBER, description: "Số tiền vào tài khoản (Phát Sinh Nợ trên sổ kế toán). Trả về 0 nếu không có." },
          credit: { type: Type.NUMBER, description: "Số tiền gốc ra khỏi tài khoản (Phát Sinh Có trên sổ kế toán), KHÔNG BAO GỒM PHÍ VÀ THUẾ. Trả về 0 nếu không có." },
          fee: { type: Type.NUMBER, description: "Phí giao dịch. Nếu không tìm thấy, trả về 0." },
          vat: { type: Type.NUMBER, description: "Thuế GTGT của giao dịch. Nếu không tìm thấy, trả về 0." },
        },
        required: ["date", "description", "debit", "credit"],
      },
    },
  },
  required: ["accountInfo", "transactions", "openingBalance", "endingBalance"],
};


/**
 * Step 1: Extracts raw text from images using Gemini for high-accuracy OCR.
 */
export const extractTextFromContent = async (content: { images: { mimeType: string; data: string }[] }): Promise<string> => {
    if (content.images.length === 0) return '';
    
    const prompt = `Bạn là một công cụ OCR (Nhận dạng ký tự quang học) chuyên dụng cho tài liệu tài chính, được tối ưu hóa để đạt độ chính xác tuyệt đối. Nhiệm vụ của bạn là trích xuất văn bản từ hình ảnh sao kê ngân hàng Việt Nam.

QUY TẮC QUAN TRỌNG NHẤT: ĐỘ CHÍNH XÁC CỦA CÁC CON SỐ LÀ TRÊN HẾT.

1.  **Ngữ cảnh tài chính:** Đây là sao kê ngân hàng. Hãy đọc với sự hiểu biết rằng các con số là cực kỳ quan trọng.
2.  **Xử lý số:**
    - Trong văn bản tài chính Việt Nam, dấu chấm (.) và dấu phẩy (,) thường được dùng làm dấu phân cách hàng nghìn.
    - **TUYỆT ĐỐI KHÔNG BỎ SÓT SỐ KHÔNG (0) Ở CUỐI.**
    - **QUY TẮC CỨNG (VÍ DỤ TỪ LỖI THỰC TẾ):** Nếu bạn thấy '3,000,000', giá trị đúng là ba triệu. TUYỆT ĐỐI KHÔNG đọc nhầm thành '30,000,000' (ba mươi triệu) hoặc '300,000' (ba trăm nghìn). Phải cực kỳ cẩn thận với số lượng số không.
3.  **Định dạng đầu ra:** Chỉ trả về văn bản thô, không định dạng, không phân tích, không tóm tắt. Trả về chính xác từng ký tự bạn thấy trên hình ảnh theo đúng thứ tự.`;

    try {
        const imageParts = content.images.map(img => ({
            inlineData: {
                mimeType: img.mimeType,
                data: img.data,
            }
        }));

        const modelRequest = {
            model: "gemini-2.5-pro",
            contents: { parts: [{ text: prompt }, ...imageParts] },
            config: {
                temperature: 0,
            }
        };

        const response = await ai.models.generateContent(modelRequest);
        return response.text.trim();

    } catch (error) {
        console.error("Error extracting text with Gemini OCR:", error);
        throw new Error("Không thể trích xuất văn bản từ file hình ảnh.");
    }
}


/**
 * Step 2: Processes the extracted text to create an accounting ledger.
 */
export const processStatement = async (content: { text: string; }): Promise<GeminiResponse> => {
  const prompt = `
    Bạn là một chuyên gia kế toán quốc tế, cực kỳ tỉ mỉ và chính xác. Nhiệm vụ của bạn là xử lý một bản sao kê ngân hàng DẠNG VĂN BẢN THÔ và chuyển đổi nó thành một định dạng sổ kế toán chuẩn với độ chính xác tuyệt đối.

    QUY TẮC BẮT BUỘC (PHẢI TUÂN THỦ NGHIÊM NGẶT):

    1. **TÁCH BIỆT PHÍ VÀ THUẾ (CỰC KỲ QUAN TRỌNG):**
       - Chủ động tìm kiếm các cột hoặc thông tin liên quan đến 'Phí' (Fee) và 'Thuế GTGT' (VAT) trong sao kê.
       - **QUY TẮC MỚI:** KHÔNG CỘNG DỒN phí và thuế vào số tiền giao dịch chính.
       - Giá trị cho cột 'credit' (Phát Sinh Có trên sổ kế toán) PHẢI LÀ SỐ TIỀN GIAO DỊCH GỐC, trước khi tính phí và thuế.
       - Trích xuất số tiền phí vào trường \`fee\`.
       - Trích xuất số tiền thuế vào trường \`vat\`.
       - Nếu không tìm thấy phí hoặc thuế cho một giao dịch, hãy trả về giá trị 0 cho các trường tương ứng.
       - **Ví dụ:** Giao dịch NỢ (tiền ra) \`818,000,000\`, Phí \`327,200\`, Thuế \`32,720\`. Trong kết quả JSON, giao dịch này phải là: \`"credit": 818000000\`, \`"fee": 327200\`, \`"vat": 32720\`, và \`"debit": 0\`.

    2. **XỬ LÝ SỐ LIỆU CHÍNH XÁC TUYỆT ĐỐI (QUAN TRỌNG NHẤT):**
       - Đây là quy tắc tối thượng. Sai sót về số liệu là không thể chấp nhận được.
       - Khi đọc các số tiền, phải nhận diện chính xác dấu phẩy (,) và dấu chấm (.) là dấu phân cách hàng nghìn.
       - **TUYỆT ĐỐI KHÔNG BỎ SÓT CÁC SỐ KHÔNG (0) Ở CUỐI.**
       - **LỖI CẦN TRÁNH:** Nếu bạn thấy '3,000,000', giá trị số đúng là \`3000000\`. TUYỆT ĐỐI KHÔNG đọc nhầm thành \`30000000\` hoặc \`300000\`.
       - **Ví dụ:** '818,000,000' phải được hiểu là \`818000000\`.
       - Trước khi trả về kết quả, hãy kiểm tra lại toàn bộ các số tiền đã trích xuất để đảm bảo không có sai sót.

    3. **Trích xuất Số dư (Rất quan trọng)**:
       - **Số dư đầu kỳ:** Chủ động tìm kiếm và trích xuất số dư đầu kỳ. Nhận diện các thuật ngữ tiếng Việt như "Số dư đầu kỳ", "Số dư cuối kỳ trước", "Số dư đầu ngày", hoặc các thuật ngữ tiếng Anh tương đương. Nếu không thể xác định, trả về 0 cho 'openingBalance'.
       - **Số dư cuối kỳ:** Chủ động tìm kiếm và trích xuất số dư cuối kỳ. Nhận diện các thuật ngữ như "Số dư cuối kỳ", "Số dư cuối ngày", hoặc các thuật ngữ tiếng Anh tương đương. Nếu không thể xác định, trả về 0 cho 'endingBalance'.

    4. **Ghi nhận giao dịch (Đảo ngược Nợ/Có)**:
       - Giao dịch tiền vào (Ngân hàng ghi CÓ, Credit) phải được ghi vào cột "debit" (Phát Sinh Nợ trên sổ kế toán).
       - Giao dịch tiền ra (Ngân hàng ghi NỢ, Debit) phải được ghi vào cột "credit" (Phát Sinh Có trên sổ kế toán).

    5. **Thông tin tài khoản**: Trích xuất Tên chủ tài khoản, Số tài khoản, Tên ngân hàng và Chi nhánh. Nếu không tìm thấy, trả về chuỗi rỗng.

    6. **Định dạng đầu ra**: Chỉ trả về kết quả dưới dạng JSON theo đúng schema đã cung cấp. Không thêm bất kỳ văn bản giải thích nào trước hoặc sau đối tượng JSON.

    Nội dung sao kê ngân hàng thô:
    ---
    ${content.text}
    ---

    Hãy phân tích văn bản trên để trả về một đối tượng JSON.
  `;

  try {
    const modelRequest = {
      model: "gemini-2.5-pro",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0,
      },
    };

    const response = await ai.models.generateContent(modelRequest);

    const jsonText = response.text.trim();
    return JSON.parse(jsonText) as GeminiResponse;
  } catch (error) {
    console.error("Error processing statement with Gemini:", error);
    throw new Error("Không thể xử lý sao kê. Vui lòng kiểm tra lại nội dung và thử lại.");
  }
};

const chatResponseSchema = {
    type: Type.OBJECT,
    properties: {
        responseText: {
            type: Type.STRING,
            description: "Một câu trả lời tự nhiên, thân thiện bằng tiếng Việt (xưng hô 'Em' và gọi người dùng là 'Anh Cường') để xác nhận hành động hoặc trả lời câu hỏi.",
        },
        action: {
            type: Type.STRING,
            description: "Hành động AI đề xuất: 'update', 'undo', 'add', hoặc 'query'.",
        },
        update: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
                index: { type: Type.NUMBER },
                field: { type: Type.STRING },
                newValue: { type: Type.NUMBER }
            },
        },
        add: {
            type: Type.OBJECT,
            nullable: true,
            description: "Một đối tượng giao dịch mới cần thêm vào báo cáo. Chỉ dùng khi action là 'add'.",
            properties: {
                transactionCode: { type: Type.STRING, description: "Mã giao dịch nếu có" },
                date: { type: Type.STRING, description: "Ngày giao dịch theo định dạng DD/MM/YYYY" },
                description: { type: Type.STRING, description: "Nội dung giao dịch" },
                debit: { type: Type.NUMBER, description: "Số tiền vào tài khoản." },
                credit: { type: Type.NUMBER, description: "Số tiền gốc ra khỏi tài khoản." },
                fee: { type: Type.NUMBER, description: "Phí giao dịch." },
                vat: { type: Type.NUMBER, description: "Thuế GTGT." },
            },
        },
        confirmationRequired: {
            type: Type.BOOLEAN,
            description: "Đặt thành true nếu hành động được đề xuất (cập nhật, thêm, hoàn tác) cần người dùng xác nhận. Nếu không, bỏ qua hoặc đặt thành false.",
            nullable: true,
        },
    },
    required: ["responseText", "action"],
};

/**
 * Handles interactive chat with the AI to query or modify the report.
 */
export const chatWithAI = async (
    message: string,
    currentReport: GeminiResponse,
    chatHistory: ChatMessage[],
    rawStatementContent: string,
    image: { mimeType: string; data: string } | null
): Promise<AIChatResponse> => {
    
    const promptParts: any[] = [
      { text: `
        Bạn là "Trợ lý Kế toán của Anh Cường", một AI thông minh, thân thiện và cực kỳ chính xác.
        
        **QUY TRÌNH LÀM VIỆC MỚI (CỰC KỲ QUAN TRỌNG):**
        1.  **Xưng hô:** Luôn xưng là "Em" và gọi người dùng là "Anh Cường".
        2.  **Định dạng Phản hồi:** Phản hồi của Em BẮT BUỘC phải là một đối tượng JSON duy nhất theo schema.
        3.  **QUY TRÌNH XÁC NHẬN:**
            - Khi Anh Cường đưa ra yêu cầu thay đổi dữ liệu (sửa, thêm, hoặc hoàn tác), Em **KHÔNG** được thực hiện ngay.
            - Thay vào đó, Em phải trả về một đối tượng JSON chứa hành động được đề xuất (ví dụ: đối tượng \`update\`), đặt \`confirmationRequired\` thành \`true\`, và đặt \`responseText\` là câu hỏi xác nhận: "Anh Cường có muốn em điều chỉnh trên báo cáo không?".
            - Chỉ khi Anh Cường hỏi một câu hỏi thông thường (query), Em mới đặt \`confirmationRequired\` là \`false\` hoặc bỏ qua.

        **NGỮ CẢNH:**
        - **Báo cáo Hiện tại:** Dữ liệu JSON của sổ kế toán mà Anh Cường đang xem.
        - **Lịch sử Trò chuyện:** Toàn bộ cuộc hội thoại trước đó để Em hiểu ngữ cảnh.
        - **Sao kê Gốc:** Nội dung văn bản thô của sao kê ban đầu để Em có thể đối chiếu lại nếu cần.
        - **Nội dung Dán vào (Tùy chọn):** Anh Cường có thể dán thêm một hình ảnh hoặc văn bản.

        **NHIỆM VỤ CỦA EM (DỰA TRÊN YÊU CẦU MỚI NHẤT):**
        - **Nếu là yêu cầu sửa/thêm/hoàn tác:** Tạo đối tượng \`update\`/\`add\`/\`undo\` tương ứng, đặt \`confirmationRequired: true\`, và hỏi xác nhận trong \`responseText\`.
        - **Nếu là câu hỏi ('query'):** Trả lời câu hỏi và đặt \`action: 'query'\`.

        ---
        **LỊCH SỬ TRÒ CHUYỆN (để Em lấy ngữ cảnh):**
        ${JSON.stringify(chatHistory, null, 2)}
        
        **YÊU CẦU MỚI NHẤT TỪ ANH CƯỜNG:**
        "${message}"
        
        **DỮ LIỆU BÁO CÁO HIỆN TẠI (JSON):**
        ${JSON.stringify(currentReport, null, 2)}
        
        **DỮ LIỆU SAO KÊ GỐC (VĂN BẢN THÔ):**
        ${rawStatementContent}
        ---

        Hãy xử lý yêu cầu của Anh Cường và trả về một đối tượng JSON duy nhất theo đúng quy trình xác nhận.
      `},
    ];

    if (image) {
        promptParts.push({ text: "Dưới đây là hình ảnh Anh Cường vừa dán vào:" });
        promptParts.push({
            inlineData: {
                mimeType: image.mimeType,
                data: image.data,
            }
        });
    }

    try {
        const modelRequest = {
            model: "gemini-2.5-pro",
            contents: { parts: promptParts },
            config: {
                responseMimeType: "application/json",
                responseSchema: chatResponseSchema,
                temperature: 0.1,
            },
        };
        const response = await ai.models.generateContent(modelRequest);
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as AIChatResponse;
    } catch (error) {
        console.error("Error chatting with AI:", error);
        return { responseText: "Xin lỗi Anh Cường, Em gặp sự cố khi xử lý yêu cầu. Anh Cường vui lòng thử lại nhé.", action: 'query' };
    }
};