/**
 * Agent username format: lowercase letters, digits, underscore only.
 * No spaces, uppercase, or special characters.
 */
export const AGENT_USERNAME_REGEX = /^[a-z0-9_]+$/;
export const AGENT_USERNAME_MIN_LENGTH = 3;
export const AGENT_USERNAME_MAX_LENGTH = 50;

export const AGENT_USERNAME_FORMAT_MESSAGE =
	'Username can only contain lowercase letters, numbers, and underscore. No spaces, uppercase, or special characters.';

export function validateAgentUsername(username: string): {
	valid: boolean;
	message?: string;
	normalized?: string;
} {
	if (!username || typeof username !== 'string') {
		return { valid: false, message: 'Username is required' };
	}
	const trimmed = username.trim();
	if (trimmed.length < AGENT_USERNAME_MIN_LENGTH) {
		return {
			valid: false,
			message: `Username must be at least ${AGENT_USERNAME_MIN_LENGTH} characters`,
		};
	}
	if (trimmed.length > AGENT_USERNAME_MAX_LENGTH) {
		return {
			valid: false,
			message: `Username must be at most ${AGENT_USERNAME_MAX_LENGTH} characters`,
		};
	}
	if (!AGENT_USERNAME_REGEX.test(trimmed)) {
		return {
			valid: false,
			message: AGENT_USERNAME_FORMAT_MESSAGE,
		};
	}
	return {
		valid: true,
		normalized: trimmed.toLowerCase(),
	};
}
