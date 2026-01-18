import { clerkClient } from "@clerk/express";

// Middleware to check userId and hasPremiumPlan

export const auth = async (req, res, next) => {
    try {
        const authObj = await req.auth();

        // If there's no authenticated session, return a clear 401
        if (!authObj || !authObj.userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const { userId, has } = authObj;

        // Safely evaluate premium plan check if available
        let hasPremiumPlan = false;
        if (typeof has === 'function') {
            try {
                hasPremiumPlan = await has({ plan: 'premium' });
            } catch (e) {
                hasPremiumPlan = false;
            }
        }

        // Fetch user metadata; if user not found, return 401
        let user;
        try {
            user = await clerkClient.users.getUser(userId);
        } catch (e) {
            return res.status(401).json({ success: false, message: 'Invalid user session' });
        }

        if (!hasPremiumPlan && user.privateMetadata && user.privateMetadata.free_usage) {
            req.free_usage = user.privateMetadata.free_usage;
        } else {
            try {
                await clerkClient.users.updateUserMetadata(userId, {
                    privateMetadata: {
                        free_usage: 0,
                    },
                });
            } catch (e) {
                // non-fatal; continue
            }
            req.free_usage = 0;
        }

        req.plan = hasPremiumPlan ? 'premium' : 'free';
        next();
    } catch (error) {
        // If Clerk throws because of missing/invalid token, return a clear 401
        return res.status(401).json({ success: false, message: error?.message || 'Authentication failed' });
    }
};