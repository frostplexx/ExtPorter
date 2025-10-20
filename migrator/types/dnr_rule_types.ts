/**
 * TypeScript types for Chrome DeclarativeNetRequest API rules
 * Based on: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
 */

export enum ResourceType {
    MAIN_FRAME = 'main_frame',
    SUB_FRAME = 'sub_frame',
    STYLESHEET = 'stylesheet',
    SCRIPT = 'script',
    IMAGE = 'image',
    FONT = 'font',
    OBJECT = 'object',
    XMLHTTPREQUEST = 'xmlhttprequest',
    PING = 'ping',
    CSP_REPORT = 'csp_report',
    MEDIA = 'media',
    WEBSOCKET = 'websocket',
    WEBTRANSPORT = 'webtransport',
    WEBBUNDLE = 'webbundle',
    OTHER = 'other',
}

export enum RuleActionType {
    BLOCK = 'block',
    REDIRECT = 'redirect',
    ALLOW = 'allow',
    UPGRADE_SCHEME = 'upgradeScheme',
    MODIFY_HEADERS = 'modifyHeaders',
    ALLOW_ALL_REQUESTS = 'allowAllRequests',
}

export enum HeaderOperation {
    APPEND = 'append',
    SET = 'set',
    REMOVE = 'remove',
}

export interface RuleCondition {
    /** URL patterns to match */
    urlFilter?: string;
    /** Regular expression to match against the URL */
    regexFilter?: string;
    /** Whether the urlFilter or regexFilter is case sensitive */
    isUrlFilterCaseSensitive?: boolean;
    /** Domains to match */
    domains?: string[];
    /** Domains to exclude */
    excludedDomains?: string[];
    /** Resource types to match */
    resourceTypes?: ResourceType[];
    /** Resource types to exclude */
    excludedResourceTypes?: ResourceType[];
    /** Request methods to match */
    requestMethods?: string[];
    /** Request methods to exclude */
    excludedRequestMethods?: string[];
    /** Domains which the request initiator must match */
    initiatorDomains?: string[];
    /** Domains which the request initiator must not match */
    excludedInitiatorDomains?: string[];
    /** Tab IDs to match (for dynamic rules) */
    tabIds?: number[];
    /** Tab IDs to exclude (for dynamic rules) */
    excludedTabIds?: number[];
}

export interface Redirect {
    /** Redirect to this URL */
    url?: string;
    /** Redirect using this extension path */
    extensionPath?: string;
    /** Redirect to a URL with this transform applied */
    transform?: URLTransform;
    /** Redirect using a regex substitution */
    regexSubstitution?: string;
}

export interface URLTransform {
    /** New scheme */
    scheme?: string;
    /** New host */
    host?: string;
    /** New port */
    port?: string;
    /** New path */
    path?: string;
    /** New query string */
    query?: string;
    /** Query parameters to add or replace */
    queryTransform?: QueryTransform;
    /** New fragment */
    fragment?: string;
    /** New username */
    username?: string;
    /** New password */
    password?: string;
}

export interface QueryTransform {
    /** Query key-value pairs to add or replace */
    addOrReplaceParams?: Array<{ key: string; value: string }>;
    /** Query keys to remove */
    removeParams?: string[];
}

export interface ModifyHeaderInfo {
    /** Header name */
    header: string;
    /** Operation to perform */
    operation: HeaderOperation;
    /** Header value (for append/set operations) */
    value?: string;
}

export interface RuleAction {
    /** Type of action */
    type: RuleActionType;
    /** Redirect configuration (for redirect action) */
    redirect?: Redirect;
    /** Request headers to modify */
    requestHeaders?: ModifyHeaderInfo[];
    /** Response headers to modify */
    responseHeaders?: ModifyHeaderInfo[];
}

export interface Rule {
    /** Unique identifier for the rule */
    id: number;
    /** Rule priority (higher values have higher priority) */
    priority?: number;
    /** Condition to match */
    condition: RuleCondition;
    /** Action to perform */
    action: RuleAction;
}

export interface Ruleset {
    /** Array of rules */
    rules?: Rule[];
}

export interface ManifestRuleResource {
    /** Unique identifier for the ruleset */
    id: string;
    /** Whether the ruleset is enabled by default */
    enabled: boolean;
    /** Path to the rules JSON file */
    path: string;
}

export interface DeclarativeNetRequestManifest {
    rule_resources: ManifestRuleResource[];
}
