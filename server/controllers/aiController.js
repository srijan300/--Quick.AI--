import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import fs from 'fs'
import pdf from 'pdf-parse/lib/pdf-parse.js'

const AI = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

// Helper function to handle errors properly
const handleError = (error, res) => {
    console.error('Error details:', {
        message: error.message,
        response: error.response ? {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            body: error.response.body
        } : null
    });

    // Handle API response errors (OpenAI SDK, axios, etc.)
    if (error.response) {
        const status = error.response.status || 500;
        // Handle null/undefined explicitly - use empty object as fallback
        let errorData = error.response.data ?? error.response.body ?? null;
        
        // If errorData is null or undefined, provide a default based on status
        if (errorData === null || errorData === undefined) {
            const defaultMessages = {
                403: 'Access forbidden. Please check your API key or permissions.',
                401: 'Unauthorized. Please check your authentication.',
                429: 'Rate limit exceeded. Please try again later.',
                500: 'Internal server error. Please try again later.'
            };
            
            return res.status(status).json({
                success: false,
                message: defaultMessages[status] || error.response.statusText || `API error: ${status}`
            });
        }
        
        // If errorData is a string, try to parse it as JSON
        if (typeof errorData === 'string') {
            try {
                errorData = JSON.parse(errorData);
            } catch (e) {
                // If parsing fails, use the string as the message
                return res.status(status).json({
                    success: false,
                    message: errorData || error.response.statusText || `API error: ${status}`
                });
            }
        }
        
        // Ensure errorData is an object (fallback to empty object if not)
        if (typeof errorData !== 'object' || errorData === null) {
            errorData = {};
        }
        
        // Try to extract error message from various possible locations
        let errorMessage = 
            errorData.error?.message || 
            errorData.error?.detail ||
            errorData.message || 
            (typeof errorData.error === 'string' ? errorData.error : null) ||
            error.response.statusText || 
            `API error: ${status}`;

        return res.status(status).json({
            success: false, 
            message: errorMessage
        });
    }

    // Handle network errors or other errors without response
    const errorMessage = error.message || 'An unexpected error occurred';
    res.status(500).json({
        success: false, 
        message: errorMessage
    });
};

export const generateArticle = async (req, res)=>{
    try {
        console.log('[generateArticle] headers:', req.headers && {
            origin: req.headers.origin,
            'content-type': req.headers['content-type'],
            authorization: req.headers.authorization ? 'present' : 'missing'
        })
        console.log('[generateArticle] body:', req.body)
        console.log('[generateArticle] file:', !!req.file)
        const { userId } = req.auth();
        const { prompt, length } = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;

        if(plan !== 'premium' && free_usage >= 10){
            return res.json({ success: false, message: "Limit reached. Upgrade to continue."})
        }

        const response = await AI.chat.completions.create({
            model: "gemini-3-flash-preview",
            messages: [{
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: length,
        });

        const content = response.choices[0].message.content

        await sql` INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, ${prompt}, ${content}, 'article')`;

        if(plan !== 'premium'){
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata:{
                    free_usage: free_usage + 1
                }
            })
        }

        res.json({ success: true, content})


    } catch (error) {
        handleError(error, res);
    }
}

export const generateBlogTitle = async (req, res)=>{
    try {
        console.log('[generateBlogTitle] headers:', req.headers && {
            origin: req.headers.origin,
            'content-type': req.headers['content-type'],
            authorization: req.headers.authorization ? 'present' : 'missing'
        })
        console.log('[generateBlogTitle] body:', req.body)
        console.log('[generateBlogTitle] file:', !!req.file)
        const { userId } = req.auth();
        const { prompt } = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;

        if(plan !== 'premium' && free_usage >= 10){
            return res.json({ success: false, message: "Limit reached. Upgrade to continue."})
        }

        const response = await AI.chat.completions.create({
            model: "gemini-3-flash-preview",
            messages: [{ role: "user", content: prompt, } ],
            temperature: 0.7,
            max_tokens: 100,
        });

        const content = response.choices[0].message.content

        await sql` INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, ${prompt}, ${content}, 'blog-title')`;

        if(plan !== 'premium'){
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata:{
                    free_usage: free_usage + 1
                }
            })
        }

        res.json({ success: true, content})


    } catch (error) {
        handleError(error, res);
    }
}


export const generateImage = async (req, res)=>{
    try {
        console.log('[generateImage] headers:', req.headers && {
            origin: req.headers.origin,
            'content-type': req.headers['content-type'],
            authorization: req.headers.authorization ? 'present' : 'missing'
        })
        console.log('[generateImage] body:', req.body)
        console.log('[generateImage] file:', !!req.file)
        const { userId } = req.auth();
        const { prompt, publish } = req.body;
        const plan = req.plan;

        if(plan !== 'premium'){
            return res.json({ success: false, message: "This feature is only available for premium subscriptions"})
        }

        
        const formData = new FormData()
        formData.append('prompt', prompt)
        const {data} = await axios.post("https://clipdrop-api.co/text-to-image/v1", formData, {
            headers: {'x-api-key': process.env.CLIPDROP_API_KEY,},
            responseType: "arraybuffer",
        })

        const base64Image = `data:image/png;base64,${Buffer.from(data, 'binary').toString('base64')}`;

        const {secure_url} = await cloudinary.uploader.upload(base64Image)
        

        await sql` INSERT INTO creations (user_id, prompt, content, type, publish) 
        VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false })`;

        res.json({ success: true, content: secure_url})

    } catch (error) {
        handleError(error, res);
    }
}

export const removeImageBackground = async (req, res)=>{
    try {
        console.log('[removeImageBackground] headers:', req.headers && {
            origin: req.headers.origin,
            'content-type': req.headers['content-type'],
            authorization: req.headers.authorization ? 'present' : 'missing'
        })
        console.log('[removeImageBackground] body:', req.body)
        console.log('[removeImageBackground] file:', !!req.file)
        const { userId } = req.auth();
        const image = req.file;
        const plan = req.plan;

        if(plan !== 'premium'){
            return res.json({ success: false, message: "This feature is only available for premium subscriptions"})
        }

        const {secure_url} = await cloudinary.uploader.upload(image.path, {
            transformation: [
                {
                    effect: 'background_removal',
                    background_removal: 'remove_the_background'
                }
            ]
        })

        await sql` INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, 'Remove background from image', ${secure_url}, 'image')`;

        res.json({ success: true, content: secure_url})

    } catch (error) {
        handleError(error, res);
    }
}

export const removeImageObject = async (req, res)=>{
    try {
        console.log('[removeImageObject] headers:', req.headers && {
            origin: req.headers.origin,
            'content-type': req.headers['content-type'],
            authorization: req.headers.authorization ? 'present' : 'missing'
        })
        console.log('[removeImageObject] body:', req.body)
        console.log('[removeImageObject] file:', !!req.file)
        const { userId } = req.auth();
        const { object } = req.body;
        const image = req.file;
        const plan = req.plan;

        if(plan !== 'premium'){
            return res.json({ success: false, message: "This feature is only available for premium subscriptions"})
        }

        const {public_id} = await cloudinary.uploader.upload(image.path)

        const imageUrl = cloudinary.url(public_id, {
            transformation: [{effect: `gen_remove:${object}`}],
            resource_type: 'image'
        })

        await sql` INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, ${`Removed ${object} from image`}, ${imageUrl}, 'image')`;

        res.json({ success: true, content: imageUrl})

    } catch (error) {
        handleError(error, res);
    }
}

export const resumeReview = async (req, res)=>{
    try {
        console.log('[resumeReview] headers:', req.headers && {
            origin: req.headers.origin,
            'content-type': req.headers['content-type'],
            authorization: req.headers.authorization ? 'present' : 'missing'
        })
        console.log('[resumeReview] body:', req.body)
        console.log('[resumeReview] file:', !!req.file)
        const { userId } = req.auth();
        const resume = req.file;
        const plan = req.plan;

        if(plan !== 'premium'){
            return res.json({ success: false, message: "This feature is only available for premium subscriptions"})
        }

        if(!resume){
            return res.status(400).json({success: false, message: "No resume file provided. Please upload a PDF file."})
        }

        if(resume.size > 5 * 1024 * 1024){
            return res.json({success: false, message: "Resume file size exceeds allowed size (5MB)."})
        }

        const dataBuffer = fs.readFileSync(resume.path)
        const pdfData = await pdf(dataBuffer)

        const prompt = `Review the following resume and provide constructive feedback on its strengths, weaknesses, and areas for improvement. Resume Content:\n\n${pdfData.text}`

       const response = await AI.chat.completions.create({
            model: "gemini-3-flash-preview",
            messages: [{ role: "user", content: prompt, } ],
            temperature: 0.7,
            max_tokens: 1000,
        });

        const content = response.choices[0].message.content

        await sql` INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, 'Review the uploaded resume', ${content}, 'resume-review')`;

        res.json({ success: true, content})

    } catch (error) {
        handleError(error, res);
    }
}