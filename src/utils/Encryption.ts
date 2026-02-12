import CryptoJS from 'crypto-js';

const SECRET_KEY = 'meshguard-default-key'; // In a real app, this would be derived from user secret

export const Encryption = {
    encrypt: (data: string): string => {
        return CryptoJS.AES.encrypt(data, SECRET_KEY).toString();
    },

    decrypt: (cipherText: string): string => {
        const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
        return bytes.toString(CryptoJS.enc.Utf8);
    },

    hash: (data: string): string => {
        return CryptoJS.SHA256(data).toString();
    }
};
