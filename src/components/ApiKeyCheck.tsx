import React, { useState, useEffect } from 'react';

export const ApiKeyCheck: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [hasKey, setHasKey] = useState<boolean>(false);
    const [checking, setChecking] = useState<boolean>(true);

    useEffect(() => {
        const checkKey = async () => {
            try {
                if (window.aistudio && window.aistudio.hasSelectedApiKey) {
                    const selected = await window.aistudio.hasSelectedApiKey();
                    setHasKey(selected);
                } else {
                    // Fallback if not in AI Studio environment
                    setHasKey(true);
                }
            } catch (e) {
                console.error(e);
                setHasKey(true); // Fallback
            } finally {
                setChecking(false);
            }
        };
        checkKey();
    }, []);

    const handleSelectKey = async () => {
        try {
            if (window.aistudio && window.aistudio.openSelectKey) {
                await window.aistudio.openSelectKey();
                // Assume success to mitigate race condition
                setHasKey(true);
            }
        } catch (e) {
            console.error(e);
            alert("Failed to select API key. Please try again.");
        }
    };

    if (checking) {
        return <div className="flex items-center justify-center h-screen">Checking API Key...</div>;
    }

    if (!hasKey) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-4">
                <div className="bg-white p-8 rounded-2xl shadow-md max-w-md w-full text-center">
                    <h2 className="text-2xl font-bold text-slate-800 mb-4">API Key Required</h2>
                    <p className="text-slate-600 mb-6">
                        To use the high-quality image generation features (Gemini 3.1 Flash Image Preview), 
                        you need to select a paid Google Cloud API key.
                    </p>
                    <button 
                        onClick={handleSelectKey}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-xl transition-colors"
                    >
                        Select API Key
                    </button>
                    <p className="mt-4 text-sm text-slate-500">
                        <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline">
                            Learn more about billing
                        </a>
                    </p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
};
