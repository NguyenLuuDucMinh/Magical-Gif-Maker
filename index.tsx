/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {GoogleGenAI, Modality, Part} from '@google/genai'; // Import Part and Modality
import {applyPalette, GIFEncoder, quantize} from 'gifenc';

// ****** QUAN TRỌNG: Đảm bảo bạn đã đặt biến môi trường API_KEY ******
// Ví dụ: trong file .env hoặc khi chạy server: API_KEY=YOUR_API_KEY_HERE npm run dev
const apiKey = process.env.API_KEY;
if (!apiKey) {
    throw new Error("API_KEY environment variable not set.");
}
const ai = new GoogleGenAI({ apiKey });
// ******************************************************************

const fps = 4;

// DOM elements
const promptInput = document.getElementById('prompt-input') as HTMLInputElement;
const imageInput = document.getElementById('image-input') as HTMLInputElement;
const imagePreview = document.getElementById('image-preview') as HTMLImageElement;
const clearImageButton = document.getElementById('clear-image-button') as HTMLButtonElement;
const generateButton = document.getElementById(
  'generate-button',
) as HTMLButtonElement;
const framesContainer = document.getElementById(
  'frames-container',
) as HTMLDivElement;
const resultContainer = document.getElementById(
  'result-container',
) as HTMLDivElement;
const statusDisplay = document.getElementById(
  'status-display',
) as HTMLDivElement;
const generationContainer = document.querySelector(
  '.generation-container',
) as HTMLDivElement;
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

// --- State for selected image ---
let selectedImageData: { mimeType: string; data: string } | null = null;
// -----------------------------

function parseError(error: string) {
    // Ưu tiên phân tích cú pháp lỗi từ thư viện Google GenAI trước
    try {
        const regexGoogle = /\[GoogleGenerativeAI Error\]:\s*(.*)/;
        const matchGoogle = error.match(regexGoogle);
        if (matchGoogle && matchGoogle[1]) {
            let detail = matchGoogle[1].trim();
            // Thử kiểm tra xem chi tiết có phải là JSON không
            if (detail.startsWith('{') && detail.endsWith('}')) {
                try {
                    const jsonError = JSON.parse(detail);
                    // Tìm thông báo lỗi trong các cấu trúc phổ biến
                    return jsonError.error?.message || jsonError.message || detail;
                } catch (e) {
                    // Không phải JSON hợp lệ, trả về chi tiết
                    return detail;
                }
            }
            // Nếu không phải JSON, trả về chi tiết trực tiếp
            return detail;
        }
    } catch (e) { /* Bỏ qua lỗi phân tích cú pháp ở đây */ }

    // Dự phòng cho các định dạng lỗi khác (ít gặp hơn với thư viện mới)
    try {
        const regexGeneric = /{"error":(.*)}/gm;
        // Cần reset lastIndex nếu sử dụng lại regex với cờ 'g'
        regexGeneric.lastIndex = 0;
        const m = regexGeneric.exec(error);
        if (m && m[1]) {
            const e = m[1];
            const err = JSON.parse(e);
            return err.message || error; // Trả về lỗi gốc nếu không có message
        }
    } catch (e) { /* Bỏ qua lỗi phân tích cú pháp ở đây */ }

    // Nếu không có định dạng nào khớp, trả về chuỗi lỗi gốc
    // Loại bỏ tiền tố không cần thiết nếu có
    return error.replace(/^Error:\s*/, '');
}


// --- Function to read file as Base64 ---
function fileToGenerativePart(file: File): Promise<Part> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        return reject(new Error("Failed to read file as string"));
      }
      // Extract Base64 data (remove prefix e.g., "data:image/png;base64,")
      const base64Data = reader.result.substring(reader.result.indexOf(',') + 1);
      resolve({
        inlineData: {
          mimeType: file.type,
          data: base64Data,
        },
      });
    };
    reader.onerror = (err) => {
       reject(new Error(`FileReader error: ${err}`)); // Thêm chi tiết lỗi
    }
    reader.readAsDataURL(file);
  });
}
// -------------------------------------

async function createGifFromPngs(
  imageUrls: string[],
  targetWidth = 1024,
  targetHeight = 1024,
) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create canvas context');
  }
  // Kiểm tra kích thước hợp lệ
  if (targetWidth <= 0 || targetHeight <= 0) {
    throw new Error(`Invalid target dimensions: ${targetWidth}x${targetHeight}`);
  }

  const gif = GIFEncoder();
  const fpsInterval = 1 / fps;
  const delay = Math.max(10, Math.round(fpsInterval * 1000)); // Đảm bảo delay không quá nhỏ

  console.log(`Creating GIF with ${imageUrls.length} frames, delay: ${delay}ms`);

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    console.log(`Processing frame ${i + 1}/${imageUrls.length}`);
    const img = new Image();
    img.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
            console.log(`Frame ${i + 1} loaded successfully.`);
            resolve();
        };
        img.onerror = (evt) => {
             console.error(`Error loading image for frame ${i + 1}:`, evt);
             // Cố gắng log chi tiết hơn nếu có thể
             const errorDetail = (evt instanceof ErrorEvent) ? evt.message : JSON.stringify(evt);
             reject(new Error(`Failed to load image for frame ${i + 1} (src: ${url.substring(0, 50)}...): ${errorDetail}`));
        };
      });

      // Đảm bảo kích thước canvas đúng trước khi vẽ
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      // Vẽ nền trắng trước khi vẽ ảnh
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      // Kiểm tra xem imageData có hợp lệ không (ví dụ: không phải toàn màu đen/trắng)
      if (!imageData || !imageData.data || imageData.data.length === 0) {
          throw new Error(`Failed to get imageData for frame ${i + 1}`);
      }

      const data = imageData.data;
      const format = 'rgb444'; // hoặc 'rgb565'
      const palette = quantize(data, 256, { format });
      const index = applyPalette(data, palette, format);
      gif.writeFrame(index, targetWidth, targetHeight, { palette, delay });
      console.log(`Frame ${i + 1} added to GIF.`);

    } catch (frameError) {
        console.error(`Error processing frame ${i + 1}:`, frameError);
        // Quyết định: bỏ qua khung hình lỗi hay dừng lại? Ở đây ta dừng lại.
        throw new Error(`Error creating GIF at frame ${i + 1}: ${frameError.message}`);
    }
     // Giải phóng bộ nhớ URL object nếu nó được tạo từ blob (không áp dụng trực tiếp ở đây vì dùng base64)
     // URL.revokeObjectURL(url); // Chỉ dùng nếu url là từ URL.createObjectURL
  }

  gif.finish();
  const buffer = gif.bytesView();
  const blob = new Blob([buffer], { type: 'image/gif' });
  const gifUrl = URL.createObjectURL(blob);
  const resultImg = new Image();
  resultImg.src = gifUrl;
  console.log("GIF created successfully.");
  return resultImg;
}

function updateStatus(message: string, progress = 0) {
  if (statusDisplay) {
    statusDisplay.textContent = message;
  }
}

function switchTab(targetTab: string) {
  tabButtons.forEach((button) => {
    if (button.getAttribute('data-tab') === targetTab) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });
  tabContents.forEach((content) => {
    if (content.id === `${targetTab}-content`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
  if (targetTab === 'output' && resultContainer) {
    resultContainer.style.display = 'flex';
  }
}

// Modified run function to accept image data
async function run(textPrompt: string, imagePart: Part | null) {
  if (framesContainer) framesContainer.textContent = '';
  if (resultContainer) resultContainer.textContent = '';
  resultContainer?.classList.remove('appear');
  switchTab('frames');
  if (resultContainer) resultContainer.style.display = 'none';

  updateStatus('Generating frames...');
  if (generateButton) {
    generateButton.disabled = true;
    generateButton.classList.add('loading');
  }
  if (imageInput) imageInput.disabled = true;
  if (clearImageButton) clearImageButton.disabled = true;

  try {
    const systemInstruction = `**Generate simple, animated doodle GIFs on white from user input, prioritizing key visual identifiers in an animated doodle style with ethical considerations.**
**Core GIF:** Doodle/cartoonish (simple lines, stylized forms, no photorealism), subtle looping motion, white background, lighthearted tone.
**Prompt Template:** "[Style] [Subject Description with Specificity]. [Text Component or Speech Bubble if any]."
**Key Constraints:** No racial labels. Cartoon/doodle style always implied, especially for people. One text display method only.`;

    let finalPrompt = textPrompt;
    if (imagePart) {
        finalPrompt += " (based on the provided image)";
    }

    const fullUserPrompt = `A doodle animation on a white background of ${finalPrompt}. Subtle motion but nothing else moves.`;
    const style = `Simple, vibrant, varied-colored doodle/hand-drawn sketch`;

    const generationPromptText = `Generate at least 5 square, white-background doodle animation frames with smooth, vibrantly colored motion showing ${fullUserPrompt}. ${imagePart ? 'Use the provided image as the main reference or subject.' : ''}

**Style:** ${style}.
**Background:** Plain solid white.
**Motion:** Each frame should show subtle but visible differences.
**Frame Count:** 5–10 frames.
**Output:** Return actual image files as output (image/png preferred).`;

    const contents: Part[] = [];
    if (imagePart) contents.push(imagePart);
    contents.push({ text: generationPromptText });

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: "user", parts: contents }],
      systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
      generationConfig: {
        temperature: 0.8,
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });

    const images: string[] = [];
    let frameCount = 0;

    const parts = response?.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('image/')) {
        frameCount++;
        const src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;

        const frameElement = document.createElement('div');
        frameElement.className = 'frame';

        const frameNumber = document.createElement('div');
        frameNumber.className = 'frame-number';
        frameNumber.textContent = frameCount.toString();
        frameElement.appendChild(frameNumber);

        const img = document.createElement('img');
        img.src = src;
        img.alt = `Generated Frame ${frameCount}`;
        frameElement.appendChild(img);
        framesContainer?.appendChild(frameElement);

        images.push(src);
        setTimeout(() => frameElement.classList.add('appear'), 50 * frameCount);
      } else if (part.text) {
        console.log("Received text part:", part.text);
      }
    }

    if (frameCount < 2) {
      updateStatus(`Failed to generate enough frames (got ${frameCount}). Try adjusting prompt or image.`);
      console.error("Not enough frames:", frameCount);
      return false;
    }

    updateStatus('Creating GIF...');
    const finalGif = await createGifFromPngs(images);
    finalGif.className = 'result-image';

    if (resultContainer) {
      resultContainer.appendChild(finalGif);

      const downloadButton = document.createElement('button');
      downloadButton.className = 'download-button';
      const icon = document.createElement('i');
      icon.className = 'fas fa-download';
      downloadButton.appendChild(icon);
      downloadButton.title = "Download GIF";
      downloadButton.onclick = () => {
        const a = document.createElement('a') as HTMLAnchorElement;
        a.href = finalGif.src;
        const safePrompt = textPrompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 30);
        a.download = `animation_${safePrompt || 'generated'}.gif`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(finalGif.src), 100);
        a.remove();
      };
      resultContainer.appendChild(downloadButton);

      switchTab('output');
      setTimeout(() => {
        resultContainer.classList.add('appear');
        generationContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }

    updateStatus('Done!');
    return true;
  } catch (error) {
    console.error("Error generating animation (raw):", error);
    const msg = parseError(error.message || String(error));
    updateStatus(`Error generating animation: ${msg}`);
    return false;
  } finally {
    if (generateButton) {
      generateButton.disabled = false;
      generateButton.classList.remove('loading');
    }
    if (imageInput) imageInput.disabled = false;
    if (clearImageButton) clearImageButton.disabled = false;
  }
}


// --- Function to clear image selection ---
function clearImageSelection() {
    if (imageInput) {
        imageInput.value = '';
    }
    if (imagePreview) {
        // Giải phóng URL object cũ trước khi reset (nếu đang dùng)
        if (imagePreview.src.startsWith('blob:')) {
            URL.revokeObjectURL(imagePreview.src);
        }
        imagePreview.style.display = 'none';
        imagePreview.src = '#';
    }
    if (clearImageButton) {
        clearImageButton.style.display = 'none';
    }
    selectedImageData = null;
    console.log("Image selection cleared.");
}
// -----------------------------------------


// Initialize the app
function main() {
  // --- Image Input Listener ---
  if (imageInput && imagePreview && clearImageButton) {
      imageInput.addEventListener('change', async (event) => {
          const files = (event.target as HTMLInputElement).files;
          if (files && files.length > 0) {
              const file = files[0];
              if (!file.type.startsWith('image/')) {
                  alert('Please select an image file.');
                  clearImageSelection();
                  return;
              }
               const maxSizeMB = 4; // Giới hạn kích thước file ảnh đầu vào
               if (file.size > maxSizeMB * 1024 * 1024) {
                   alert(`Image size exceeds ${maxSizeMB}MB limit.`);
                   clearImageSelection();
                   return;
               }

              updateStatus("Reading image...");
              try {
                    const part = await fileToGenerativePart(file);
                    selectedImageData = part.inlineData;

                    // Giải phóng URL object cũ nếu có trước khi tạo cái mới
                    if (imagePreview.src.startsWith('blob:')) {
                        URL.revokeObjectURL(imagePreview.src);
                    }
                    // Hiển thị preview hiệu quả hơn bằng URL.createObjectURL
                    imagePreview.src = URL.createObjectURL(file);
                    imagePreview.style.display = 'block';
                    clearImageButton.style.display = 'inline-block';
                    updateStatus("Image ready.");
                    console.log("Image selected and processed:", selectedImageData.mimeType);
              } catch (error) {
                  console.error("Error reading file:", error);
                  alert(`Error reading image file: ${error.message}`);
                  clearImageSelection();
                  updateStatus("Error reading image.");
              }
          } else {
               clearImageSelection();
          }
      });

       clearImageButton.addEventListener('click', clearImageSelection);

  } else {
      // Lỗi này không nên xảy ra nếu HTML đúng
      console.error("CRITICAL: Image input, preview, or clear button elements not found in the DOM. Check HTML IDs.");
      alert("Error initializing image input elements. Please check the console.");
  }
  // --------------------------


  if (generateButton) {
    generateButton.addEventListener('click', async () => {
      if (promptInput) {
        const textValue = promptInput.value.trim();
        if (!textValue) {
             alert("Please enter a text prompt.");
             promptInput.focus();
             return;
        }

        const imagePart = selectedImageData
            ? { inlineData: selectedImageData }
            : null;

         // Chỉ thử 1 lần vì gọi API khá tốn kém và lỗi thường không tự hết
         const success = await run(textValue, imagePart);

         if (success) {
             console.log('Generation successful.');
         } else {
             console.log('Generation failed.');
             // Thông báo lỗi đã được cập nhật trong hàm run
         }
      }
    });
  }

  if (promptInput) {
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        generateButton?.click();
      }
    });
    promptInput.addEventListener('focus', (e) => {
        // Bỏ chọn tự động vì có thể gây khó chịu
        // promptInput.select();
        e.preventDefault();
    });
  }

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetTab = button.getAttribute('data-tab');
      if (targetTab) switchTab(targetTab);
    });
  });

  switchTab('frames'); // Bắt đầu ở tab frames
}

// Đảm bảo DOM đã tải xong trước khi chạy main
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main(); // DOM đã sẵn sàng
}