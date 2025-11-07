/**
 * Favorites Manager
 * Manages favorite scenes using Stash GraphQL API with a special tag
 */
const FAVORITE_TAG_NAME = 'StashGifs Favorite';
export class FavoritesManager {
    constructor(api) {
        this.favoriteTagId = null;
        this.favoriteTagPromise = null;
        this.api = api;
    }
    /**
     * Get or create the favorite tag
     */
    async getFavoriteTagId() {
        // If we already have it cached, return it
        if (this.favoriteTagId) {
            return this.favoriteTagId;
        }
        // If there's already a request in progress, wait for it
        if (this.favoriteTagPromise) {
            return this.favoriteTagPromise;
        }
        // Start a new request
        this.favoriteTagPromise = this.findOrCreateFavoriteTag();
        const tagId = await this.favoriteTagPromise;
        this.favoriteTagId = tagId;
        return tagId;
    }
    /**
     * Find existing favorite tag or create it
     */
    async findOrCreateFavoriteTag() {
        try {
            // First, try to find the tag
            const existingTag = await this.api.findTagByName(FAVORITE_TAG_NAME);
            if (existingTag) {
                return existingTag.id;
            }
            // If not found, create it
            const newTag = await this.api.createTag(FAVORITE_TAG_NAME);
            return newTag?.id || null;
        }
        catch (error) {
            console.error('FavoritesManager: Failed to get favorite tag', error);
            return null;
        }
    }
    /**
     * Check if a marker is favorited
     */
    async isFavorite(marker) {
        try {
            const tagId = await this.getFavoriteTagId();
            if (!tagId)
                return false;
            return await this.api.markerHasTag(marker, tagId);
        }
        catch (error) {
            console.error('FavoritesManager: Failed to check favorite status', error);
            return false;
        }
    }
    /**
     * Toggle favorite status for a marker
     */
    async toggleFavorite(marker) {
        try {
            console.log('FavoritesManager: Toggling favorite for marker', marker.id);
            const tagId = await this.getFavoriteTagId();
            if (!tagId) {
                throw new Error('Favorite tag not available');
            }
            console.log('FavoritesManager: Using favorite tag ID', tagId);
            const isCurrentlyFavorite = await this.isFavorite(marker);
            console.log('FavoritesManager: Current favorite status', isCurrentlyFavorite);
            if (isCurrentlyFavorite) {
                // Remove tag
                console.log('FavoritesManager: Removing tag from marker');
                await this.api.removeTagFromMarker(marker, tagId);
                console.log('FavoritesManager: Tag removed successfully');
                return false;
            }
            else {
                // Add tag
                console.log('FavoritesManager: Adding tag to marker');
                await this.api.addTagToMarker(marker, tagId);
                console.log('FavoritesManager: Tag added successfully');
                return true;
            }
        }
        catch (error) {
            console.error('FavoritesManager: Failed to toggle favorite', error);
            throw error;
        }
    }
    /**
     * Set favorite status (without toggling)
     */
    async setFavorite(marker, favorite) {
        try {
            const tagId = await this.getFavoriteTagId();
            if (!tagId) {
                throw new Error('Favorite tag not available');
            }
            const isCurrentlyFavorite = await this.isFavorite(marker);
            if (favorite && !isCurrentlyFavorite) {
                await this.api.addTagToMarker(marker, tagId);
            }
            else if (!favorite && isCurrentlyFavorite) {
                await this.api.removeTagFromMarker(marker, tagId);
            }
        }
        catch (error) {
            console.error('FavoritesManager: Failed to set favorite', error);
            throw error;
        }
    }
}
//# sourceMappingURL=FavoritesManager.js.map